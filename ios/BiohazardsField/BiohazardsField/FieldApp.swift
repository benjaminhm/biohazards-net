import ARKit
import CoreLocation
import RealityKit
import SwiftUI
import UIKit

@main
struct BiohazardsFieldApp: App {
    @StateObject private var model = FieldModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
        }
    }
}

@MainActor
final class FieldModel: ObservableObject {
    @Published var pin = ""
    @Published var person: PinPerson?
    @Published var jobs: [PinJob] = []
    @Published var job: PinJob?
    @Published var note = ""
    @Published var busy = false
    @Published var message = ""
    @Published var error = ""
    let location = SiteLocation()

    func boot() async {
        guard let saved = PinStore.load() else { return }
        pin = saved
        await verify(saved)
    }

    func verify(_ candidate: String) async {
        guard candidate.count == 4, candidate.allSatisfy(\.isNumber) else { return }
        busy = true
        error = ""
        defer { busy = false }
        do {
            let (person, jobs) = try await FieldAPI.signIn(pin: candidate)
            self.person = person
            self.jobs = jobs
            self.pin = candidate
            PinStore.save(candidate)
            if job == nil { job = jobs.first }
        } catch {
            self.person = nil
            PinStore.clear()
            self.error = error.localizedDescription
        }
    }

    func signOut() {
        PinStore.clear()
        person = nil
        pin = ""
        jobs = []
        job = nil
    }

    func sendPhoto(_ image: UIImage) async {
        guard let person, let job else {
            error = "Choose a job first."
            return
        }
        busy = true
        error = ""
        message = ""
        defer { busy = false }
        let taken = Date()
        let point = await location.current()
        let gps = point.map { "GPS \($0.coordinate.latitude.formatted(.number.precision(.fractionLength(5)))), \($0.coordinate.longitude.formatted(.number.precision(.fractionLength(5))))" } ?? "GPS UNAVAILABLE"
        let lines = [
            "TIME: \(PhotoStamp.brisbane(taken))",
            "USER: \(person.name) (\(person.person_code))  ·  JOB: \(job.job_code)",
            note.isEmpty ? gps : "\(gps)  ·  NOTE: \(note)",
        ]
        guard let jpeg = PhotoStamp.jpeg(image, lines: lines) else {
            error = "Could not prepare that photo."
            return
        }
        do {
            try await FieldAPI.uploadPhoto(
                pin: pin,
                job: job,
                jpeg: jpeg,
                note: note,
                stamp: lines.joined(separator: " · "),
                takenAt: taken,
                location: point
            )
            note = ""
            message = "Photo is on job \(job.job_code)."
        } catch {
            self.error = error.localizedDescription
        }
    }

    func sendScan(_ package: ScanPackage) async throws {
        guard let job else { throw FieldAPIError.message("Choose a job first.") }
        let point = await location.current()
        try PendingUploadStore.save(pendingRecord(job: job, package: package, point: point), in: package.directory)
        try await FieldAPI.uploadScan(pin: pin, job: job, package: package, note: note, location: point)
        if let cover = package.cover, let image = UIImage(contentsOfFile: cover.path) {
            await sendPhoto(image)
        }
        try? FileManager.default.removeItem(at: package.directory)
        if error.isEmpty {
            message = "Scan is on job \(job.job_code)."
        } else {
            error = "Scan is on job \(job.job_code). The cover photo did not upload. \(error)"
        }
        note = ""
    }

    /// Files a scan that was saved on the phone when the upload did not finish.
    func flushPending() async {
        for (upload, folder) in PendingUploadStore.waiting() {
            let package = ScanPackage(
                directory: folder,
                mesh: folder.appendingPathComponent("mesh.usdz"),
                video: folder.appendingPathComponent("walkthrough.mp4"),
                timeline: folder.appendingPathComponent("timeline.json"),
                cover: FileManager.default.fileExists(atPath: folder.appendingPathComponent("cover.jpg").path)
                    ? folder.appendingPathComponent("cover.jpg") : nil,
                startedAt: ISO8601DateFormatter().date(from: upload.startedAt) ?? Date(),
                duration: upload.duration
            )
            let job = PinJob(job_id: upload.jobId, job_code: upload.jobCode, label: upload.jobCode, address: "")
            let point = upload.lat.flatMap { lat in
                upload.lng.map { lng in
                    CLLocation(
                        coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                        altitude: 0,
                        horizontalAccuracy: upload.accuracy ?? -1,
                        verticalAccuracy: -1,
                        timestamp: Date()
                    )
                }
            }
            do {
                try await FieldAPI.uploadScan(pin: upload.pin, job: job, package: package, note: upload.note, location: point)
                try? FileManager.default.removeItem(at: folder)
                message = "A saved scan is now on job \(upload.jobCode)."
            } catch {
                self.error = error.localizedDescription
                break
            }
        }
    }

    private func pendingRecord(job: PinJob, package: ScanPackage, point: CLLocation?) -> PendingUpload {
        PendingUpload(
            pin: pin,
            jobId: job.job_id,
            jobCode: job.job_code,
            note: note,
            startedAt: ISO8601DateFormatter().string(from: package.startedAt),
            duration: package.duration,
            lat: point?.coordinate.latitude,
            lng: point?.coordinate.longitude,
            accuracy: point?.horizontalAccuracy
        )
    }
}

struct RootView: View {
    @EnvironmentObject private var model: FieldModel

    var body: some View {
        NavigationStack {
            if model.person == nil {
                PinPadView()
            } else {
                JobHomeView()
            }
        }
        .task {
            await model.boot()
            await model.flushPending()
        }
    }
}

struct PinPadView: View {
    @EnvironmentObject private var model: FieldModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("FORENSIC CLEANING QLD")
                .font(.caption.weight(.heavy))
                .foregroundStyle(Color.accentColor)
            Text("Field")
                .font(.largeTitle.weight(.black))
            Text("Enter your 4-digit person PIN. Photos and LiDAR scans go on the open job file.")
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                ForEach(0..<4, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(index < model.pin.count ? Color.accentColor : Color.white.opacity(0.2), lineWidth: 2)
                        .frame(height: 64)
                        .overlay(Text(index < model.pin.count ? "●" : "").font(.title.bold()))
                }
            }
            if !model.error.isEmpty {
                Text(model.error).foregroundStyle(.red).font(.subheadline.weight(.semibold))
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "⌫"], id: \.self) { key in
                    Button(key) { tap(key) }
                        .font(.title2.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .background(Color.white.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .disabled(model.busy)
                }
            }
            Spacer()
        }
        .padding(20)
        .background(Color(red: 8 / 255, green: 13 / 255, blue: 23 / 255).ignoresSafeArea())
    }

    private func tap(_ key: String) {
        model.error = ""
        if key == "Clear" {
            model.pin = ""
        } else if key == "⌫" {
            if !model.pin.isEmpty { model.pin.removeLast() }
        } else if model.pin.count < 4 {
            model.pin.append(key)
            if model.pin.count == 4 {
                Task { await model.verify(model.pin) }
            }
        }
    }
}

struct JobHomeView: View {
    @EnvironmentObject private var model: FieldModel
    @State private var showCamera = false
    @State private var showScan = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("LOGGED-IN OPERATOR")
                        .font(.caption2.weight(.heavy))
                        .foregroundStyle(Color.accentColor)
                    Text(model.person?.name ?? "")
                        .font(.title3.weight(.black))
                }
                Spacer()
                Button("Switch PIN") { model.signOut() }
                    .font(.caption.weight(.bold))
            }
            Picker("Job", selection: Binding(
                get: { model.job?.id ?? "" },
                set: { id in model.job = model.jobs.first { $0.id == id } }
            )) {
                Text("Choose a job").tag("")
                ForEach(model.jobs) { job in
                    Text(job.label).tag(job.id)
                }
            }
            .pickerStyle(.menu)
            if let address = model.job?.address, !address.isEmpty {
                Text(address).font(.subheadline).foregroundStyle(.green)
            }
            TextField("Note for this photo or scan", text: $model.note, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
            if !model.message.isEmpty {
                Text(model.message).foregroundStyle(.green).font(.subheadline.weight(.semibold))
            }
            if !model.error.isEmpty {
                Text(model.error).foregroundStyle(.red).font(.subheadline.weight(.semibold))
            }
            Button {
                showCamera = true
            } label: {
                Label("Take photo", systemImage: "camera.fill")
                    .frame(maxWidth: .infinity, minHeight: 54)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.job == nil || model.busy)
            Button {
                showScan = true
            } label: {
                Label("LiDAR scan", systemImage: "cube.transparent")
                    .frame(maxWidth: .infinity, minHeight: 54)
            }
            .buttonStyle(.bordered)
            .disabled(model.job == nil || model.busy)
            Text("A scan records the room mesh and a walkthrough video on the same clock, then files both on the job.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(16)
        .navigationTitle(model.job?.job_code ?? "Job")
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(red: 8 / 255, green: 13 / 255, blue: 23 / 255).ignoresSafeArea())
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                Task { await model.sendPhoto(image) }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showScan) {
            ScanScreen { package in
                try await model.sendScan(package)
            }
        }
    }
}

struct ScanScreen: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var scanner = SpatialScannerManager()
    @State private var saving = false
    @State private var error = ""
    var onPackage: (ScanPackage) async throws -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            ARContainer(session: scanner.arSession).ignoresSafeArea()
            VStack(spacing: 12) {
                Text(scanner.status)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text("\(Int(scanner.elapsed))s  ·  \(scanner.anchorCount) mesh parts")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                if !error.isEmpty {
                    Text(error).font(.caption.weight(.semibold)).foregroundStyle(.red)
                }
                HStack {
                    Button("Cancel") {
                        scanner.cancel()
                        dismiss()
                    }
                    .disabled(saving)
                    Spacer()
                    Button(saving ? "Saving…" : "Stop and file") {
                        Task { await finish() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || scanner.phase == .unsupported)
                }
            }
            .padding()
            .background(.ultraThinMaterial)
        }
        .onAppear { scanner.startSimultaneousScan() }
        .onChange(of: scanner.phase) { phase in
            if phase == .limitReached { Task { await finish() } }
        }
    }

    @MainActor
    private func finish() async {
        if saving { return }
        guard scanner.phase == .scanning || scanner.phase == .limitReached else { return }
        saving = true
        error = ""
        do {
            let package = try await scanner.stopAndExport()
            try await onPackage(package)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            saving = false
        }
    }
}

struct ARContainer: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero)
        view.automaticallyConfigureSession = false
        view.session = session
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {}
}

struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImage: (UIImage) -> Void
        init(onImage: @escaping (UIImage) -> Void) { self.onImage = onImage }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onImage(image) }
            picker.dismiss(animated: true)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }
    }
}
