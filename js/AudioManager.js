// AudioManager.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export class AudioManager {
    constructor(camera, scene) { // Removed opts and hearingRange from constructor
        this.camera = camera;
        this.scene = scene;
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
        document.addEventListener("click", resume);
        document.addEventListener("touchstart", resume);
        console.log("AudioManager initialized. Listener attached to camera:", camera.uuid);
    }

    playSpatial(url, worldPosition, { loop = false, volume = 1, hearingRange = 100, rolloffFactor = 2, distanceModel = 'linear' } = {}) {
        const pa = new THREE.PositionalAudio(this.listener);
        pa.position.copy(worldPosition);
        pa.setLoop(loop);

        // Use the passed hearingRange, volume, rolloffFactor, and distanceModel
        pa.setRefDistance(1); // Usually 1, the distance at which volume is 100%
        pa.setMaxDistance(hearingRange); // Sounds beyond this distance will be silent.
        pa.setRolloffFactor(rolloffFactor);
        pa.setDistanceModel(distanceModel);

        pa.setVolume(volume);

        this.scene.add(pa);
        this.active.add(pa);

        this.loader.load(
            url,
            (buffer) => {
                pa.setBuffer(buffer);
                pa.play();
                if (!loop) {
                    pa.source.onended = () => {
                        this.scene.remove(pa);
                        this.active.delete(pa);
                    };
                }
            },
            undefined,
            (err) => {
                console.error(`Error loading spatial sound "${url}":`, err);
                this.scene.remove(pa);
                this.active.delete(pa);
            }
        );
        return loop ? pa : null;
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

export function initializeAudioManager(camera, scene) {
    console.log("Attempting to initialize AudioManager...");
    console.log("Camera received:", camera);
    console.log("Scene received:", scene);

    if (!camera || !scene) {
        console.error("Cannot initialize AudioManager: Camera or Scene are undefined/null. AudioManager will not be created.");
        return;
    }
    if (audioManagerInstance) {
        console.warn("AudioManager already initialized. Stopping existing sounds and reinitializing.");
        audioManagerInstance.stopAll();
    }
    // No longer passing hearingRange to the constructor
    audioManagerInstance = new AudioManager(camera, scene);
    window.audioManager = audioManagerInstance;
    console.log("AudioManager successfully initialized with camera:", camera.uuid, "at initial position:", camera.position.toArray());
}
