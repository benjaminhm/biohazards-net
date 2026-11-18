# Field

Private iPhone app for biohazards.net job files. It is installed from Xcode onto company phones. It is not on the public App Store.

The same 4-digit photo PIN as [photo.biohazards.net](https://photo.biohazards.net) signs the operator in.

- Take photo files the JPEG on the job through `POST /api/photo`, the same path as the phone camera.
- LiDAR scan records a USDZ room mesh and a walkthrough video from one ARKit session, so both share `ARFrame.timestamp`. The phone puts the files in the private `job-scans` bucket with a signed URL from `POST /api/photo/scan`. The job file lists a finished scan under Photos, then Scans.

A second camera session cannot run beside ARKit, because ARKit already owns the rear camera. The walkthrough is that rear camera, time-aligned with the mesh. LiDAR needs an iPhone Pro or iPad Pro. Photos still work on an iPhone without LiDAR.

## Install

1. Open `ios/BiohazardsField/BiohazardsField.xcodeproj` in Xcode 16 or later, on a Mac.
2. Select the BiohazardsField target, Signing & Capabilities, and choose the company Apple developer team.
3. Connect the iPhone, trust the computer, and run the Field scheme.

The bundle id is `net.biohazards.field`.
