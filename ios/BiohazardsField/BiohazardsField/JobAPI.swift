import CoreLocation
import Foundation
import Security
import UIKit

enum FieldAPIError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

struct PinPerson: Decodable {
    let person_id: String
    let org_id: String
    let name: String
    let person_code: String
}

struct PinJob: Decodable, Identifiable {
    let job_id: String?
    let job_code: String
    let label: String
    let address: String
    var id: String { job_id ?? job_code }
}

struct SignedUpload: Decodable {
    let path: String
    let signedUrl: String
    let token: String
    let contentType: String
}

struct ScanUploads: Decodable {
    let mesh: SignedUpload
    let video: SignedUpload
    let timeline: SignedUpload
}

struct ScanStartResponse: Decodable {
    let scan_id: String
    let job_id: String
    let job_code: String
    let uploads: ScanUploads
}

enum PinStore {
    private static let account = "photo-pin"

    static func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let pin = String(data: data, encoding: .utf8),
              pin.count == 4 else { return nil }
        return pin
    }

    static func save(_ pin: String) {
        let data = Data(pin.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum FieldAPI {
    static let base = URL(string: "https://photo.biohazards.net")!

    static func signIn(pin: String) async throws -> (PinPerson, [PinJob]) {
        var parts = URLComponents(url: base.appendingPathComponent("api/photo"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "pin", value: pin)]
        let (data, response) = try await URLSession.shared.data(from: parts.url!)
        try check(response, data)
        let body = try JSONDecoder().decode(SignInBody.self, from: data)
        guard let person = body.person else { throw FieldAPIError.message("Invalid 4-digit PIN.") }
        return (person, body.jobs ?? [])
    }

    static func uploadPhoto(
        pin: String,
        job: PinJob,
        jpeg: Data,
        note: String,
        stamp: String,
        takenAt: Date,
        location: CLLocation?
    ) async throws {
        var request = URLRequest(url: base.appendingPathComponent("api/photo"))
        request.httpMethod = "POST"
        let boundary = "Field-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        field("pin", pin)
        field("job_code", job.job_code)
        if let jobId = job.job_id { field("job_id", jobId) }
        field("photo_tag", "assessment")
        field("note", note)
        field("stamp_text", stamp)
        field("device_time", ISO8601DateFormatter().string(from: takenAt))
        if let location {
            field("lat", String(location.coordinate.latitude))
            field("lng", String(location.coordinate.longitude))
            field("accuracy_m", String(location.horizontalAccuracy))
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        try check(response, data)
    }

    static func uploadScan(
        pin: String,
        job: PinJob,
        package: ScanPackage,
        note: String,
        location: CLLocation?
    ) async throws {
        for file in [package.mesh, package.video, package.timeline] {
            let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
            if size > 100 * 1024 * 1024 {
                throw FieldAPIError.message("\(file.lastPathComponent) is over 100 MB.")
            }
        }
        var payload: [String: Any] = [
            "pin": pin,
            "job_code": job.job_code,
            "note": note,
            "started_at": ISO8601DateFormatter().string(from: package.startedAt),
            "duration_s": package.duration,
        ]
        if let jobId = job.job_id { payload["job_id"] = jobId }
        if let location {
            payload["lat"] = location.coordinate.latitude
            payload["lng"] = location.coordinate.longitude
            payload["accuracy_m"] = location.horizontalAccuracy
        }
        var request = URLRequest(url: base.appendingPathComponent("api/photo/scan"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response, data)
        let started = try JSONDecoder().decode(ScanStartResponse.self, from: data)
        try await put(started.uploads.mesh, file: package.mesh)
        try await put(started.uploads.video, file: package.video)
        try await put(started.uploads.timeline, file: package.timeline)
        var done = URLRequest(url: base.appendingPathComponent("api/photo/scan/complete"))
        done.httpMethod = "POST"
        done.setValue("application/json", forHTTPHeaderField: "Content-Type")
        done.httpBody = try JSONSerialization.data(withJSONObject: ["pin": pin, "scan_id": started.scan_id])
        let (doneData, doneResponse) = try await URLSession.shared.data(for: done)
        try check(doneResponse, doneData)
    }

    private static func put(_ upload: SignedUpload, file: URL) async throws {
        guard let url = URL(string: upload.signedUrl) else {
            throw FieldAPIError.message("Could not prepare \(file.lastPathComponent).")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(upload.contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        let (data, response) = try await URLSession.shared.upload(for: request, fromFile: file)
        try check(response, data)
    }

    private static func check(_ response: URLResponse, _ data: Data) throws {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let parsed = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw FieldAPIError.message(parsed ?? "The job file did not accept that (\(code)).")
        }
    }

    private struct SignInBody: Decodable {
        let person: PinPerson?
        let jobs: [PinJob]?
        let error: String?
    }
}

final class SiteLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var wait: CheckedContinuation<CLLocation?, Never>?

    func current() async -> CLLocation? {
        manager.delegate = self
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
            return manager.location
        }
        return await withCheckedContinuation { continuation in
            wait = continuation
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        wait?.resume(returning: locations.last)
        wait = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        wait?.resume(returning: manager.location)
        wait = nil
    }
}

struct PendingUpload: Codable {
    var pin: String
    var jobId: String?
    var jobCode: String
    var note: String
    var startedAt: String
    var duration: Double
    var lat: Double?
    var lng: Double?
    var accuracy: Double?
}

enum PendingUploadStore {
    static func save(_ upload: PendingUpload, in folder: URL) throws {
        try JSONEncoder().encode(upload).write(to: folder.appendingPathComponent("upload.json"), options: .atomic)
    }

    static func waiting() -> [(PendingUpload, URL)] {
        let folders = (try? FileManager.default.contentsOfDirectory(
            at: PendingScans.root(),
            includingPropertiesForKeys: nil
        )) ?? []
        return folders.compactMap { folder in
            guard let data = try? Data(contentsOf: folder.appendingPathComponent("upload.json")),
                  let upload = try? JSONDecoder().decode(PendingUpload.self, from: data) else { return nil }
            return (upload, folder)
        }
    }
}

enum PhotoStamp {
    static func jpeg(_ image: UIImage, lines: [String]) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let maxWidth: CGFloat = 1600
        let scale = min(1, maxWidth / max(image.size.width, 1))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let stamped = renderer.image { ctx in
            image.draw(in: CGRect(origin: .zero, size: size))
            let clean = lines.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            guard !clean.isEmpty else { return }
            let fontSize = max(18, size.width / 36)
            let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .bold)
            let headerFont = UIFont.monospacedSystemFont(ofSize: max(12, fontSize * 0.72), weight: .heavy)
            let lineHeight = fontSize * 1.38
            let padX = fontSize * 0.85
            let padY = fontSize * 0.7
            let bar = CGFloat(clean.count) * lineHeight + padY * 2 + fontSize * 1.1
            let top = max(0, size.height - bar)
            UIColor(red: 8 / 255, green: 13 / 255, blue: 23 / 255, alpha: 0.86).setFill()
            ctx.fill(CGRect(x: 0, y: top, width: size.width, height: bar))
            UIColor(red: 1, green: 107 / 255, blue: 53 / 255, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: top, width: size.width, height: max(3, fontSize * 0.22)))
            let header = "VERIFIED FIELD EVIDENCE RECORD — LOGGED TO AUDIT TRAIL" as NSString
            header.draw(
                at: CGPoint(x: padX, y: top + padY),
                withAttributes: [.font: headerFont, .foregroundColor: UIColor(red: 1, green: 107 / 255, blue: 53 / 255, alpha: 1)]
            )
            for (index, line) in clean.enumerated() {
                (line as NSString).draw(
                    at: CGPoint(x: padX, y: top + padY + headerFont.lineHeight + 6 + CGFloat(index) * lineHeight),
                    withAttributes: [.font: font, .foregroundColor: UIColor.white]
                )
            }
        }
        return stamped.jpegData(compressionQuality: 0.84)
    }

    static func brisbane(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.timeZone = TimeZone(identifier: "Australia/Brisbane")
        formatter.dateFormat = "d MMM yyyy, HH:mm:ss"
        return formatter.string(from: date) + " AEST"
    }
}
