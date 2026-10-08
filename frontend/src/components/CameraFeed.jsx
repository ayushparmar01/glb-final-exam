import React, { useEffect, useRef, useState } from "react";

export default function CameraFeed({ onProctorEvent, examActive }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");

  // 1. Initialise & Protect Camera
  useEffect(() => {
    let stream = null;

    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, frameRate: 15 },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
        }
      } catch (err) {
        onProctorEvent?.("CAMERA_PERMISSION_DENIED", { message: err.message });
      }
    }

    setupCamera();

    // 2. Anti-Tamper DOM Mutation Observer
    const observer = new MutationObserver(() => {
      if (!containerRef.current || !videoRef.current) {
        onProctorEvent?.("CAMERA_PREVIEW_TAMPERED", {
          reason: "DOM element removed",
        });
        return;
      }
      const style = window.getComputedStyle(containerRef.current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        setWarningMessage("Warning: Camera preview must remain visible!");
        onProctorEvent?.("CAMERA_PREVIEW_HIDDEN", { points: 15 });
      }
    });

    if (containerRef.current) {
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        childList: true,
      });
    }

    return () => {
      observer.disconnect();
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-4 right-4 z-50 w-48 h-36 bg-black rounded-lg shadow-2xl overflow-hidden border-2 border-indigo-500 pointer-events-auto"
      style={{ minWidth: "192px", minHeight: "144px" }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      {warningMessage && (
        <div className="absolute inset-0 bg-red-900/80 text-white text-xs p-2 flex items-center justify-center text-center font-bold">
          {warningMessage}
        </div>
      )}
      <div className="absolute top-1 left-2 flex items-center space-x-1">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[10px] text-white font-mono uppercase tracking-wider">
          PROCTORING
        </span>
      </div>
    </div>
  );
}
