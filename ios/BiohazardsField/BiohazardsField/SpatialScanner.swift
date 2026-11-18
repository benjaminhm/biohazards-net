import ARKit
import AVFoundation
import CoreImage
import Foundation
import MetalKit
import ModelIO
import simd
import UIKit

enum ScanError: LocalizedError {
    case noLiDAR
    case metalUnavailable
    case emptyMesh
    case noVideo
    case writer(String)

    var errorDescription: String? {
        switch self {
        case .noLiDAR:
            return "This iPhone has no LiDAR. Photos still go on the job."
        case .metalUnavailable:
            return "This device cannot build a 3D mesh."
        case .emptyMesh:
            return "No room mesh yet. Walk closer to the walls and scan a little longer."
        case .noVideo:
            return "The camera did not record a video frame."
        case .writer(let message):
            return message
        }
    }
}

struct ScanTimeline: Codable {
    var clock: String
    var startedAt: String
    var videoFile: String
    var meshFile: String
    var meshAnchorCount: Int
    var samples: [Sample]

    struct Sample: Codable {
        var pts: Double
        var unix: String
    }
}

struct ScanPackage {
    let directory: URL
    let mesh: URL
    let video: URL
    let timeline: URL
    let cover: URL?
    let startedAt: Date
    let duration: TimeInterval
}

/// Records the AR camera into an MP4 whose presentation time starts at the first frame.
/// ARKit already owns the rear camera, so a second AVCaptureSession cannot run beside it.
final class SyncedVideoRecorder {
    private let width = 720
    private let height = 1280
    private let lock = NSLock()
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var zero: TimeInterval?
    private var stopped = false
    private var lastPts: TimeInterval = -1
    private var lastSample: TimeInterval = -1
    private var startedAt: Date?
    private var frameCount = 0
    private var samples: [ScanTimeline.Sample] = []
    private let context = CIContext()
    private let iso = ISO8601DateFormatter()

    func reset() {
        lock.lock()
        writer = nil
        input = nil
        adaptor = nil
        stopped = false
        zero = nil
        lastPts = -1
        lastSample = -1
        startedAt = nil
        frameCount = 0
        samples = []
        lock.unlock()
    }

    func append(_ frame: ARFrame) {
        lock.lock()
        defer { lock.unlock() }
        if stopped { return }
        let timestamp = frame.timestamp
        if zero == nil {
            zero = timestamp
            startedAt = Date()
        }
        let pts = timestamp - (zero ?? timestamp)
        if lastPts >= 0, pts - lastPts < (1.0 / 15.0) { return }
        guard prepareWriterIfNeeded() else { return }
        guard let adaptor, let input, input.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool else { return }
        var pixel: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixel)
        guard let pixel else { return }

        let oriented = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let scale = min(CGFloat(width) / oriented.extent.width, CGFloat(height) / oriented.extent.height)
        let scaled = oriented.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let dx = (CGFloat(width) - scaled.extent.width) / 2 - scaled.extent.origin.x
        let dy = (CGFloat(height) - scaled.extent.height) / 2 - scaled.extent.origin.y
        let fitted = scaled.transformed(by: CGAffineTransform(translationX: dx, y: dy))
        context.render(
            fitted,
            to: pixel,
            bounds: CGRect(x: 0, y: 0, width: width, height: height),
            colorSpace: CGColorSpaceCreateDeviceRGB()
        )
        let time = CMTime(seconds: pts, preferredTimescale: 600)
        if adaptor.append(pixel, withPresentationTime: time) {
            lastPts = pts
            frameCount += 1
            if lastSample < 0 || pts - lastSample >= 1 {
                lastSample = pts
                let unix = startedAt?.addingTimeInterval(pts) ?? Date()
                samples.append(ScanTimeline.Sample(pts: pts, unix: iso.string(from: unix)))
            }
        }
    }

    func finish(to url: URL) async throws -> (startedAt: Date, samples: [ScanTimeline.Sample]) {
        lock.lock()
        stopped = true
        let writer = self.writer
        let input = self.input
        let frames = frameCount
        let started = startedAt ?? Date()
        let taken = samples
        lock.unlock()
        guard let writer, let input, frames > 0 else { throw ScanError.noVideo }
        input.markAsFinished()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting { continuation.resume() }
        }
        if writer.status != .completed {
            throw ScanError.writer(writer.error?.localizedDescription ?? "Could not finish the video.")
        }
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try FileManager.default.moveItem(at: writer.outputURL, to: url)
        return (started, taken)
    }

    private func prepareWriterIfNeeded() -> Bool {
        if writer != nil { return true }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("scan-\(UUID().uuidString).mp4")
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return false }
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 1_200_000,
                AVVideoExpectedSourceFrameRateKey: 15,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
            ]
        )
        guard writer.canAdd(input) else { return false }
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)
        self.writer = writer
        self.input = input
        self.adaptor = adaptor
        return writer.status == .writing
    }
}

enum MeshUSDZExporter {
    static func export(anchors: [ARMeshAnchor], to url: URL) throws {
        guard let device = MTLCreateSystemDefaultDevice() else { throw ScanError.metalUnavailable }
        let allocator = MTKMeshBufferAllocator(device: device)
        let asset = MDLAsset()
        for anchor in anchors where anchor.geometry.faces.count > 0 {
            asset.add(makeMesh(anchor, allocator: allocator))
        }
        guard asset.count > 0 else { throw ScanError.emptyMesh }
        try asset.export(to: url)
    }

    private static func makeMesh(_ anchor: ARMeshAnchor, allocator: MTKMeshBufferAllocator) -> MDLMesh {
        let vertices = worldVertices(anchor)
        let indices = triangleIndices(anchor.geometry.faces)
        let vertexBytes = vertices.count * MemoryLayout<SIMD3<Float>>.stride
        let vertexBuffer = allocator.newBuffer(vertexBytes, type: .vertex)
        vertices.withUnsafeBytes { raw in
            memcpy(vertexBuffer.map().bytes, raw.baseAddress!, vertexBytes)
        }
        let indexBytes = indices.count * MemoryLayout<UInt32>.stride
        let indexBuffer = allocator.newBuffer(indexBytes, type: .index)
        indices.withUnsafeBytes { raw in
            memcpy(indexBuffer.map().bytes, raw.baseAddress!, indexBytes)
        }
        let descriptor = MDLVertexDescriptor()
        descriptor.attributes[0] = MDLVertexAttribute(
            name: MDLVertexAttributePosition,
            format: .float3,
            offset: 0,
            bufferIndex: 0
        )
        descriptor.layouts[0] = MDLVertexBufferLayout(stride: MemoryLayout<SIMD3<Float>>.stride)
        let submesh = MDLSubmesh(
            indexBuffer: indexBuffer,
            indexCount: indices.count,
            indexType: .uInt32,
            geometryType: .triangles,
            material: nil
        )
        let mesh = MDLMesh(vertexBuffer: vertexBuffer, vertexCount: vertices.count, descriptor: descriptor, submeshes: [submesh])
        mesh.name = "room-\(anchor.identifier.uuidString)"
        return mesh
    }

    private static func worldVertices(_ anchor: ARMeshAnchor) -> [SIMD3<Float>] {
        let source = anchor.geometry.vertices
        let base = source.buffer.contents()
        var out: [SIMD3<Float>] = []
        out.reserveCapacity(source.count)
        for index in 0..<source.count {
            let local = base.advanced(by: source.offset + source.stride * index).assumingMemoryBound(to: SIMD3<Float>.self).pointee
            let world = anchor.transform * SIMD4<Float>(local.x, local.y, local.z, 1)
            out.append(SIMD3(world.x, world.y, world.z))
        }
        return out
    }

    private static func triangleIndices(_ faces: ARGeometryElement) -> [UInt32] {
        let count = faces.count * faces.indexCountPerPrimitive
        let base = faces.buffer.contents()
        var out: [UInt32] = []
        out.reserveCapacity(count)
        for index in 0..<count {
            let pointer = base.advanced(by: index * faces.bytesPerIndex)
            let value: UInt32
            switch faces.bytesPerIndex {
            case 2: value = UInt32(pointer.assumingMemoryBound(to: UInt16.self).pointee)
            case 4: value = pointer.assumingMemoryBound(to: UInt32.self).pointee
            default: value = UInt32(pointer.assumingMemoryBound(to: UInt8.self).pointee)
            }
            out.append(value)
        }
        return out
    }
}

/// One ARKit session builds the LiDAR mesh and the walkthrough video.
/// Both use ARFrame.timestamp, so a second of video is the same second of the scan.
final class SpatialScannerManager: NSObject, ObservableObject, ARSessionDelegate {
    let arSession = ARSession()
    @Published var phase: Phase = .idle
    @Published var elapsed: TimeInterval = 0
    @Published var anchorCount = 0
    @Published var status = "Walk the room. The mesh and the video share one clock."

    enum Phase: Equatable {
        case idle
        case scanning
        case limitReached
        case unsupported
        case saving
        case failed
    }

    private let recorder = SyncedVideoRecorder()
    private let state = NSLock()
    private var meshes: [UUID: ARMeshAnchor] = [:]
    private var lastFrame: ARFrame?
    private var startedAt: Date?
    private var tick: Timer?
    private let maxDuration: TimeInterval = 180

    func startSimultaneousScan() {
        guard phase == .idle || phase == .failed || phase == .unsupported else { return }
        guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) else {
            phase = .unsupported
            status = ScanError.noLiDAR.localizedDescription
            return
        }
        state.lock()
        meshes.removeAll()
        lastFrame = nil
        state.unlock()
        recorder.reset()
        anchorCount = 0
        elapsed = 0
        let configuration = ARWorldTrackingConfiguration()
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
            configuration.sceneReconstruction = .meshWithClassification
        } else {
            configuration.sceneReconstruction = .mesh
        }
        configuration.environmentTexturing = .none
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            configuration.frameSemantics.insert(.sceneDepth)
        }
        startedAt = Date()
        phase = .scanning
        status = "Walk the room. The mesh and the video share one clock."
        arSession.delegate = self
        arSession.delegateQueue = DispatchQueue(label: "net.biohazards.field.ar")
        arSession.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        tick?.invalidate()
        tick = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.pulse()
        }
    }

    func stopAndExport() async throws -> ScanPackage {
        tick?.invalidate()
        tick = nil
        phase = .saving
        arSession.pause()
        state.lock()
        let anchors = Array(meshes.values)
        let coverFrame = lastFrame
        state.unlock()
        let started = startedAt ?? Date()
        let duration = Date().timeIntervalSince(started)

        let folder = PendingScans.directory()
        let meshURL = folder.appendingPathComponent("mesh.usdz")
        let videoURL = folder.appendingPathComponent("walkthrough.mp4")
        let timelineURL = folder.appendingPathComponent("timeline.json")
        do {
            let video = try await recorder.finish(to: videoURL)
            try MeshUSDZExporter.export(anchors: anchors, to: meshURL)
            var coverURL: URL?
            if let coverFrame, let data = FrameJPEG.make(frame: coverFrame) {
                let url = folder.appendingPathComponent("cover.jpg")
                try data.write(to: url, options: .atomic)
                coverURL = url
            }
            let timeline = ScanTimeline(
                clock: "ARFrame.timestamp. Video PTS 0 is startedAt.",
                startedAt: ISO8601DateFormatter().string(from: video.startedAt),
                videoFile: videoURL.lastPathComponent,
                meshFile: meshURL.lastPathComponent,
                meshAnchorCount: anchors.count,
                samples: video.samples
            )
            try JSONEncoder().encode(timeline).write(to: timelineURL, options: .atomic)
            PendingScans.excludeFromBackup(folder)
            return ScanPackage(
                directory: folder,
                mesh: meshURL,
                video: videoURL,
                timeline: timelineURL,
                cover: coverURL,
                startedAt: started,
                duration: duration
            )
        } catch {
            try? FileManager.default.removeItem(at: folder)
            phase = .failed
            status = error.localizedDescription
            throw error
        }
    }

    func cancel() {
        tick?.invalidate()
        tick = nil
        arSession.pause()
        recorder.reset()
        phase = .idle
    }

    private func pulse() {
        guard let startedAt, phase == .scanning else { return }
        elapsed = Date().timeIntervalSince(startedAt)
        if elapsed >= maxDuration {
            phase = .limitReached
            status = "3 minute limit. Saving the scan…"
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        state.lock()
        lastFrame = frame
        state.unlock()
        recorder.append(frame)
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { store(anchors) }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { store(anchors) }

    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        state.lock()
        for anchor in anchors { meshes.removeValue(forKey: anchor.identifier) }
        let count = meshes.count
        state.unlock()
        DispatchQueue.main.async { self.anchorCount = count }
    }

    private func store(_ anchors: [ARAnchor]) {
        state.lock()
        for anchor in anchors {
            if let mesh = anchor as? ARMeshAnchor { meshes[mesh.identifier] = mesh }
        }
        let count = meshes.count
        state.unlock()
        DispatchQueue.main.async { self.anchorCount = count }
    }
}

enum FrameJPEG {
    static func make(frame: ARFrame, maxWidth: CGFloat = 1600) -> Data? {
        let image = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let scale = min(1, maxWidth / max(image.extent.width, 1))
        let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let context = CIContext()
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg).jpegData(compressionQuality: 0.84)
    }
}

enum PendingScans {
    static func root() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PendingScans", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        excludeFromBackup(base)
        return base
    }

    static func directory() -> URL {
        let url = root().appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func excludeFromBackup(_ url: URL) {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var copy = url
        try? copy.setResourceValues(values)
    }
}
