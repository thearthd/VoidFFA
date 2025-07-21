// AudioManager.js

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export class AudioManager {
  constructor(camera, scene, opts = {}) {
    this.camera = camera;
    this.scene = scene;
    this.hearingRange = opts.hearingRange ?? 100;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.loader = new THREE.AudioLoader();
    this.active = new Set();
    const resume = () => {
      const ctx = this.listener.context;
      if (ctx.state === "suspended") ctx.resume().finally(() => {});
      document.removeEventListener("click", resume);
      document.removeEventListener("touchstart", resume);
    };
    // Attach event listeners for audio context resume
    document.addEventListener("click", resume);
    document.addEventListener("touchstart", resume);
    console.log("AudioManager initialized. Listener attached to camera:", camera.uuid);
  }

  playSpatial(url, worldPosition, { loop = false, volume = 1, rolloffFactor = 2, distanceModel = 'linear' } = {}) {
    const pa = new THREE.PositionalAudio(this.listener);
    pa.position.copy(worldPosition); // Position the sound source in the world
    pa.setLoop(loop);

    // --- Changes for gradual range ---
    pa.setRefDistance(1); // The distance where the volume is 100%. Adjust if needed.
    pa.setMaxDistance(this.hearingRange); // Sounds beyond this distance will be silent.
    pa.setRolloffFactor(rolloffFactor); // How quickly the volume falls off. Higher values mean faster falloff.
    pa.setDistanceModel(distanceModel); // 'linear', 'inverse', or 'exponential'. 'inverse' is often good for realism.
    // --- End changes ---

    // The initial volume passed in will scale the entire spatial audio effect
    pa.setVolume(volume);

    this.scene.add(pa); // Add the positional audio object to the scene
    this.active.add(pa); // Keep track of active sounds

    this.loader.load(
      url,
      (buffer) => {
        pa.setBuffer(buffer);
        pa.play();
        if (!loop) {
          pa.source.onended = () => {
            this.scene.remove(pa); // Remove from scene when done
            this.active.delete(pa); // Remove from active set
          };
        }
      },
      // onProgress callback
      undefined,
      // onError callback
      (err) => {
        console.error(`Error loading spatial sound "${url}":`, err);
        this.scene.remove(pa);
        this.active.delete(pa);
      }
    );
    return loop ? pa : null; // Return PositionalAudio for looping sounds if needed
  }

  stopLoop(pa) {
    if (!pa) return;
    pa.stop();
    if (pa.source && typeof pa.source.disconnect === "function") {
      try {
        pa.source.disconnect();
      } catch (e) {
        console.error("Error disconnecting audio source:", e);
      }
    }
    this.scene.remove(pa);
    this.active.delete(pa);
  }

  stopAll() {
    for (const pa of Array.from(this.active)) {
      pa.stop();
      this.scene.remove(pa);
      this.active.delete(pa);
    }
  }
}
