

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { PhysicsController } from "./physics.js";
import { localPlayerId } from "./network.js";
import { updateCrosshair } from "./game.js";
import { getSpreadMultiplier, getSpreadDirection, getRecoilAngle, ADS_FOV } from './cs2_logic.js';
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { sendTracer, sendSoundEvent } from "./network.js";
import { updateAmmoDisplay, updateInventory } from "./ui.js";
import { mergeBufferGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sendBulletHole } from "./network.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Loader } from './Loader.js';


// ff


const scopeOverlay = document.getElementById('scopeOverlay');

export const _prototypeModels = {};
let camera = window.camera

const loader = new OBJLoader();
const objURL = "https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/deagle.obj";
loader.load(
  objURL,
  (group) => {
    group.scale.set(0.01, 0.01, 0.01);
    group.position.set(0, 0, 0);
    group.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xdddddd,
          metalness: 0.5,
          roughness: 0.4
        });
      }
    });
    scene.add(group);
  },
  (xhr) => {
    if (xhr.lengthComputable) {
      console.log(`Model ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
    }
  },
  (err) => {
    console.error("Error loading OBJ:", err);
  }
);


function playBodyHit() {
    setTimeout(() => {
        let bodyHit = new Audio("https://codehs.com/uploads/a20a1a356bea275a0b124e706b1e24ba");
        bodyHit.volume = 1;
        bodyHit.play();
       // console.log("playBodyHit")
    }, 100);
}

function playBodyHeadshot() {
    setTimeout(() => {
        let bodyHeadshot = new Audio("https://codehs.com/uploads/de124c69b20be47b9fa42b1b1b1aa580");
        bodyHeadshot.volume = 1;
        bodyHeadshot.play();
      //  console.log("playBodyHeadshot")
    }, 100);
}

function createMetalMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.9,
    roughness: 0.3,
    envMapIntensity: 1
  });
}
function createPlasticMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.1,
    roughness: 0.8
  });
}
function createWoodMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.0,
    roughness: 0.7
  });
}
function createSkinMaterial(color = "#f5be90") {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8 });
}
function createGlassMaterial(color, opacity) {
  return new THREE.MeshPhysicalMaterial({
    color: color,
    metalness: 0,
    roughness: 0.1,
    transmission: 0.9,
    transparent: true,
    opacity: opacity,
    ior: 1.5,
    thickness: 0.1
  });
}
function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
let swingTime;

export class WeaponController {
  static WEAPONS = {
    knife: {
      name: "Knife",
      bodyDamage: 70,
      isMelee: true,
      magazineSize: Infinity,
      swingTime: 300/600,
      heavySwingTime: 300/600,
      pullDuration: 300/600/2,
      reloadDuration: null,
      speedModifier: 1 + 0.0,
      rpm: 120,
      tracerLength: 0,
    },
    deagle: {
      name: "Desert Eagle",
      isMelee: false,
      headshotDamage: 180,
      bodyDamage: 86,
      fireRateRPM: 125,
      magazineSize: 8,
      reloadDuration: 1.8,
      pullDuration: 125/600*1.5,
      recoilDistance: 0.08,
      recoilDuration: 0.08,
      tracerLength: 100,
      speedModifier: 0.7 + 0.0,
      tracerLength: 30,
    },
    "ak-47": {
      name: "AK-47",
      isMelee: false,
      headshotDamage: 100,
      bodyDamage: 30,
      fireRateRPM: 600,
      magazineSize: 25,
      reloadDuration: 2.5,
      pullDuration: 0.6,
      recoilDistance: 0.07,
      recoilDuration: 0.06,
      tracerLength: 100,
      speedModifier: 0.65 + 0.0,
      tracerLength: 20,
    },
    marshal: {
      name: "Marshal",
      isMelee: false,
      headshotDamage: 250,
      bodyDamage: 100,
      fireRateRPM: 48,
      magazineSize: 5,
      reloadDuration: 2.8,
      pullDuration: 48/60,
      recoilDistance: 0.12,
      recoilDuration: 0.1,
      isSniper: true,
      tracerLength: 100,
      speedModifier: 0.4 + 0.0,
      tracerLength: 40,
    },
    m79: {
      name: "M-79",
      isMelee: false,
      headshotDamage: 54,
      bodyDamage: 20,
      fireRateRPM: 405,
      magazineSize: 12,
      reloadDuration: 1.8,
      pullDuration: 125/600*1.5,
      recoilDistance: 0.08,
      recoilDuration: 0.08,
      tracerLength: 100,
      speedModifier: 0.85 + 0.0,
      tracerLength: 20,
    },
  };

  static SOUNDS = {
    knife: {
      shot: 'https://codehs.com/uploads/a3b7d894d7ce224bc7dcbc93181862da',
      pull: 'https://codehs.com/uploads/433c856c847bc650b59d966f155b3f1d',
      reloadStart: null,
      reloadEnd: null,
    },
    deagle: {
      shot: 'https://codehs.com/uploads/ab0452d6facfe07db8d94ac658195a5d',
      pull: 'https://codehs.com/uploads/c1b3935dd9777a8d32037e1538c5a09e',
      reloadStart: 'https://codehs.com/uploads/238ffcd55332e871083db2bf7644aff1',
      reloadEnd: 'https://codehs.com/uploads/830cd250b21f3da989f345833a010cbf',
    },
    'ak-47': {
      shot: 'https://codehs.com/uploads/35aaccb252e92205c08699da0818c524',
      pull: 'https://codehs.com/uploads/2f1ba563e325477717d4f97e18ff62b2',
      reloadStart: 'https://codehs.com/uploads/fb84ff53478328e3b508a65097a7cd7b',
      reloadEnd: 'https://codehs.com/uploads/3275c387a1288d0a040b8aebb3958e97',
    },
    marshal: {
      shot: 'https://codehs.com/uploads/c706ed1686988515f8767aa46952fd23',
      pull: 'https://codehs.com/uploads/c5684202c108d053ba61561a62e4c1ca',
      reloadStart: 'https://codehs.com/uploads/80601ac1055d110402b6a87d3520b025',
      reloadEnd: 'https://codehs.com/uploads/171d3fdd7af759a85fd178bb706ff0ad',
    },
    m79: {
      shot: 'https://codehs.com/uploads/8b81838df3b08b56fac7f26a2ca9e7c3',
      pull: 'https://codehs.com/uploads/aff98052ce443af0016300655d234189',
      reloadStart: 'https://codehs.com/uploads/c037824e7ad86dcf55ca2e89b0b893af',
      reloadEnd: 'https://codehs.com/uploads/bb78ded10db4f1f4a9092d5744bda11a',
    },
  };

 constructor(camera, playersRef, holesRef, createTracer, localPlayerId, physicsController) {
    this.camera = window.camera;
    this.physicsController = window.physicsController;
    this.playersRef = playersRef;
    this.holesRef = holesRef;
    this.createTracer = createTracer;
    this.localPlayerId = localPlayerId;
    this._prevFire = false;
    this._lastKnifeSwingTime = 0;
    this.stats = WeaponController.WEAPONS.knife;
    this.ammoInMagazine = this.stats.magazineSize;
    this.ammoStore = {};
    this.isReloadingFlag = false;
    this.lastShotTime = 0;
    this.burstCount = 0;
    this._reloadEndPlayed = false;
    this.checkMeleeHit = this.checkMeleeHit.bind(this);
    this.viewModel = new THREE.Group();
    this.parts = { slide: null, muzzle: null };
    this.state = { pulling: false, pullStart: 0, pullFrom: new THREE.Vector3(), pullTo: new THREE.Vector3(), recoiling: false, recoilStart: 0, reloading: false, reloadStart: 0, knifeSwing: false, knifeSwingStart: 0, knifeHeavy: false, tracerObjects: [] };
    this.audio = {};
    for (const [key, paths] of Object.entries(WeaponController.SOUNDS)) {
      this.audio[key] = {
        shot: paths.shot ? new Audio(paths.shot) : null,
        pull: paths.pull ? new Audio(paths.pull) : null,
        reloadStart: paths.reloadStart ? new Audio(paths.reloadStart) : null,
        reloadEnd: paths.reloadEnd ? new Audio(paths.reloadEnd) : null
      };
    }
    this.offPos = new THREE.Vector3(0.5, -0.7, -1.5);
    this.readyPos = new THREE.Vector3(0.3, -0.5, -0.7);
    this.readyRot = new THREE.Euler(0, 0, 0);
    this._lastKnifeSwingTime = 0;
    this.createPlayerArm();
    this.viewModel.position.copy(this.readyPos);
    this.viewModel.rotation.copy(this.readyRot);

    this.scene = window.scene;
    this.raycaster = new THREE.Raycaster();

this._recoil = {
  currentOffset: 0,
  peakOffset:    0,
  recoilStartTime: 0,
  recoilDuration:  0.25
};
  }

equipWeapon(weaponKey) {
    if (!WeaponController.WEAPONS[weaponKey]) {
        console.warn(`[WeaponController] Unknown weapon: ${weaponKey}`);
        return;
    }

    // 1) Save current ammo
    if (this.currentKey) {
        this.ammoStore[this.currentKey] = this.ammoInMagazine;
    }

    // 2) Clear any tracer lines
    if (this.state.tracerObjects) {
        this.state.tracerObjects.forEach(entry => {
            if (entry.lineMesh.parent) {
                entry.lineMesh.parent.remove(entry.lineMesh);
            }
        });
    }

    // 3) Remove old viewModel from camera
    if (this.viewModel && this.viewModel.parent === this.camera) {
        this.camera.remove(this.viewModel);
    }

    // 4) Reset core state
    this.currentKey = weaponKey; // <--- THIS IS WHERE THE WEAPON KEY IS SET
    this.stats = WeaponController.WEAPONS[weaponKey];
    this.isReloadingFlag = false;
    this.lastShotTime = 0;
    this.burstCount = 0;
    this.speedModifier = this.stats.speedModifier;
    this.ammoInMagazine = this.ammoStore[weaponKey] != null
        ? this.ammoStore[weaponKey]
        : this.stats.magazineSize;
    this.state = {
        pulling: false,
        pullStart: 0,
        pullFrom: new THREE.Vector3(),
        pullTo: new THREE.Vector3(),
        recoiling: false,
        recoilStart: 0,
        reloading: false,
        reloadStart: 0,
        knifeSwing: false,
        knifeSwingStart: 0,
        knifeHeavy: false,
        tracerObjects: []
    };

    // 5) Create a fresh ViewModel container
    this.viewModel = new THREE.Group();
    this.viewModel.name = "ViewModelRoot";
    this.createPlayerArm();

    // 6) Try to clone the preloaded prototype
    const key = weaponKey.replace(/-/g, "").toLowerCase();
    const proto = _prototypeModels[key];

    // ensure we clear out any old `parts`
    this.parts = {};

    const onModelReady = (modelGroup) => {
        // 6.a) Attach into viewModel
        this.viewModel.add(modelGroup);

        // — keep a direct reference for update() swings/recoils —
        this.weaponModel = modelGroup;

        // 6.b) Look for a child named "Muzzle" anywhere under modelGroup
        let muzzle = null;
        modelGroup.traverse(child => {
            if (child.name === "Muzzle") muzzle = child;
        });
        if (muzzle) {
            this.parts.muzzle = muzzle;
            // console.log(`[WeaponController] ${key}: found muzzle at`, muzzle.position);
        } else {
            // console.warn(`[WeaponController] ${key}: no "Muzzle" object found in model`);
        }

        // 7) Do animation‑in
        this.viewModel.position.copy(this.offPos);
        this.viewModel.rotation.copy(this.readyRot);
        this.camera.add(this.viewModel);
        this.state.pulling = true;
        this.state.pullStart = performance.now() / 1000;
        this.state.pullFrom.copy(this.offPos);
        this.state.pullTo.copy(this.readyPos);

        // 8) Play the pull sound
        const pullSnd = this.audio[this.currentKey].pull;
        if (pullSnd) {
            pullSnd.currentTime = 0;
            pullSnd.play();
            const pos = new THREE.Vector3();
            this.camera.getWorldPosition(pos);
            sendSoundEvent(this.currentKey, "pull", pos);
        }

        // 9) Update UI
        // This is the ideal place for UI updates related to weapon change
        updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize);
        
        // ***************************************************************
        // ADD THIS LINE HERE: UPDATE THE INVENTORY HIGHLIGHT
        updateInventory(this.currentKey); // Pass the newly equipped weapon key
        // ***************************************************************

        // console.log(
        // `Equipped (key="${weaponKey}") → speedModifier =`,
        // this.speedModifier
        // );
    };

    if (proto) {
        const clone = proto.clone(true);
        clone.visible = true;

        // Apply baked‐in transforms for each weapon
        switch (key) {
            case "knife":
                clone.scale.set(0.001, 0.001, 0.001);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(90),
                    THREE.MathUtils.degToRad(160),
                    0
                );
                clone.position.set(0.5, -0.1, -0.7);
                break;
            case "deagle":
                clone.scale.set(0.3, 0.3, 0.3);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(7),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(
                    0.15 * (window.innerWidth / 1920),
                    0.10 * (window.innerHeight / 1080),
                    -0.1 * (window.innerWidth / 1920)
                );
                break;
            case "ak47":
                clone.scale.set(0.4, 0.4, 0.4);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(4),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(
                    0.35 * (window.innerWidth / 1920),
                    -0.15 * (window.innerHeight / 1080),
                    -0.3 * (window.innerWidth / 1920)
                );
                break;
            case "marshal":
                clone.scale.set(1, 1, 1);
                clone.rotation.set(0, 0, 0);
                clone.position.set(
                    0.15 * (window.innerWidth / 1920),
                    0.15 * (window.innerHeight / 1080),
                    -0.1 * (window.innerWidth / 1920)
                );
                break;
            case "m79":
                clone.scale.set(0.3, 0.3, 0.3);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(7),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(
                    0.15 * (window.innerWidth / 1920),
                    0.10 * (window.innerHeight / 1080),
                    -0.1 * (window.innerWidth / 1920)
                );
                break;
            default:
                console.warn(`[WeaponController] No transform logic for "${key}"`);
        }

        // console.log(`[WeaponController] equipWeapon(): cloned "${key}" prototype`);
        onModelReady(clone);

    } else {
        // Fallback to buildX methods, which themselves populate this.parts.muzzle
        console.warn(`[WeaponController] Prototype for "${key}" missing → running build${capitalize(key)}()`);
        const originalOnLoaded = (weaponGroup) => onModelReady(weaponGroup);

        switch (key) {
            case "knife":
                this.buildKnife();
                onModelReady(this.weaponModel);
                break;
            case "deagle":
                this.buildDeagle();
                onModelReady(this.weaponModel);
                break;
            case "ak47":
                this.buildAK47();
                onModelReady(this.weaponModel);
                break;
            case "marshal":
                this.buildMarshal();
                onModelReady(this.weaponModel);
                break;
            case "m79":
                this.buildM79();
                onModelReady(this.weaponModel);
                break;
            default:
                console.error(`[WeaponController] No build method for "${key}"`);
                break;
        }
    }
}








  playWeaponSound(soundType) {
    const soundSrc = WeaponController.SOUNDS[this.currentKey]?.[soundType];
    if (soundSrc) {
      const snd = new Audio(soundSrc);
      snd.volume = 1;
      snd.play().catch(() => {});
      const pos = new THREE.Vector3();
      this.camera.getWorldPosition(pos);
      sendSoundEvent(this.currentKey, soundType, pos);
    }
  }

update(inputState, delta, playerState) {
  // --- Lazy initialize any weapon (incl. knife) if we haven't yet ---
  if (!this.viewModel) {
    this.equipWeapon(this.currentKey || "knife");
    return;
  }

  const velocity      = playerState.velocity;
  const isCrouched    = playerState.isCrouched;
  const wishAim       = inputState.aim;
  const isGrounded    = playerState.physicsController.isGrounded;
  const now           = performance.now() / 1000;
  const justClicked   = inputState.fireJustPressed;
  const defaultAimPos = new THREE.Vector3(0, -0.3, -0.5);

  // Handle weapon switch & ADS positioning
  if (this.currentKey !== this._prevKey) {
    if (this._prevKey === "marshal" && this._aiming) {
      scopeOverlay.style.display = 'none';
    }
    this._prevKey = this.currentKey;

    if (this._aiming) {
      const targetFov = this.stats.isSniper
        ? ADS_FOV.marshal
        : this.currentKey === "ak-47"
          ? ADS_FOV.ak47
          : this.currentKey === "deagle"
            ? ADS_FOV.deagle
            : this.currentKey === "m79"
              ? ADS_FOV.m79
              : ADS_FOV.default;

      const toPos = this.currentKey === "marshal"
        ? new THREE.Vector3(-0.025, -0.035, -0.2)
        : defaultAimPos.clone();

      const scaleFactor = targetFov / this._baseFov;
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
      this.viewModel.scale.copy(this._baseScale.clone().multiplyScalar(scaleFactor));
      this.viewModel.position.copy(toPos);

      if (this.currentKey === "marshal") {
        scopeOverlay.style.display = 'block';
        this.viewModel.visible = false;
      } else {
        this.viewModel.visible = true;
      }
    }
  }

  // Handle slide-pull animation
  if (this.state.pulling) {
    const tPull = (now - this.state.pullStart) / this.stats.pullDuration;
    if (tPull >= 1) {
      this.viewModel.position.copy(this.state.pullTo);
      this.state.pulling = false;
    } else {
      this.viewModel.position.lerpVectors(this.state.pullFrom, this.state.pullTo, tPull);
    }
  }

  // Crosshair spread
  let spreadAngle = getSpreadMultiplier(
    this.currentKey,
    velocity,
    isCrouched,
    this._aiming,
    isGrounded,
    this.burstCount
  );
  updateCrosshair(spreadAngle);
  playerState.isAirborne = !isGrounded;

  // Reset AK burst when you stop firing
  if (!inputState.fire && this.currentKey === "ak-47") {
    this.burstCount = 0;
  }

  // Aim toggle tweening
  if (wishAim !== this._prevWishAim) {
    this._baseFov    = this.camera.fov;
    this._baseScale  = this.viewModel.scale.clone();
    this._fromPos    = this.viewModel.position.clone();

    const targetFov = wishAim
      ? (this.stats.isSniper
          ? ADS_FOV.marshal
          : this.currentKey === "ak-47"
            ? ADS_FOV.ak47
            : this.currentKey === "deagle"
              ? ADS_FOV.deagle
              : this.currentKey === "m79"
                ? ADS_FOV.m79
                : ADS_FOV.default)
      : ADS_FOV.default;

    const toPos = wishAim
      ? (this.currentKey === "marshal"
          ? new THREE.Vector3(-0.025, -0.035, -0.2)
          : defaultAimPos.clone())
      : this.readyPos.clone();

    this._fovTween = {
      active:    true,
      fromFov:   this._baseFov,
      toFov:     targetFov,
      fromScale: this._baseScale.clone(),
      toScale:   this._baseScale.clone().multiplyScalar(targetFov / this._baseFov),
      fromPos:   this._fromPos.clone(),
      toPos:     toPos,
      startTime: now,
      duration:  0.2
    };

    scopeOverlay.style.display = 'none';
  }
  this._prevWishAim = wishAim;

  if (this._fovTween.active) {
    const t  = (now - this._fovTween.startTime) / this._fovTween.duration;
    const s  = t >= 1 ? 1 : t * t * (3 - 2 * t);
    if (t >= 1) {
      this._fovTween.active = false;
      this._aiming = wishAim;
      if (this.currentKey === "marshal") {
        if (this._aiming) {
          scopeOverlay.style.display = 'block';
          this.viewModel.visible = false;
        } else {
          this.viewModel.visible = true;
        }
      }
    }
    this.camera.fov = THREE.MathUtils.lerp(this._fovTween.fromFov, this._fovTween.toFov, s);
    this.camera.updateProjectionMatrix();
    this.viewModel.scale.copy(
      this._fovTween.fromScale.clone().lerp(this._fovTween.toScale, s)
    );
    this.viewModel.position.copy(
      this._fovTween.fromPos.clone().lerp(this._fovTween.toPos, s)
    );
  }

  // --- FIRING / SWINGING LOGIC ---
  if (!this.state.pulling && inputState.fire && !this.isReloadingFlag) {
    const secsPerShot = 60 / this.stats.fireRateRPM;
    const sinceLast   = now - this.lastShotTime;
    const isSemi      = ["deagle","marshal","m79"].includes(this.currentKey);
    const canFire     = this.stats.isMelee
                        ? justClicked && sinceLast > (this._aiming ? this.stats.heavySwingTime : this.stats.swingTime)
                        : (isSemi ? justClicked && sinceLast > secsPerShot : sinceLast > secsPerShot);

    if (canFire) {
      // —— MELEE KNIFE SWING ——
      if (this.stats.isMelee) {
        this.state.knifeSwing      = true;
        this.state.knifeSwingStart = now;
        this.state.knifeHeavy      = this._aiming;
        this.playWeaponSound("shot");
        this.checkMeleeHit(playerState.collidables);
        this.lastShotTime         = now;
      } else {
        // —— BULLET FIRE ——
        if (this.ammoInMagazine > 0) {
          this.lastShotTime    = now;
          this.ammoInMagazine--;
          this.burstCount++;

          this.fireBullet(spreadAngle, playerState.collidables);
          this.playWeaponSound("shot");
          updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize);

          // Camera recoil: capture start rotation so recovery returns from here
          const shotIndex = this.burstCount - 1;
          let rawRecoil = getRecoilAngle(this.currentKey, shotIndex);
          let appliedRecoilAngle = rawRecoil*3;
          if (this.currentKey === "ak-47" && shotIndex >= 7) appliedRecoilAngle = 0.008;
          if (this.currentKey === "ak-47" && shotIndex == 9) appliedRecoilAngle = 0.007;
          if (this.currentKey === "ak-47" && shotIndex >= 10) appliedRecoilAngle = 0.005;
          if (this._aiming) appliedRecoilAngle /= 2;

          this._recoil.peakOffset      = appliedRecoilAngle;
          this._recoil.recoilStartTime = now;
          this._recoil.recoveryPoint = this.camera.rotation.clone();

          // View-model kickback
          this.state.recoiling   = true;
          this.state.recoilStart = now;
        } else {
          // Start reload
          this.isReloadingFlag = true;
          this.state.reloading  = true;
          this.state.reloadStart = now;
          this._reloadEndPlayed = false;
          this.playWeaponSound("reloadStart");
        }
      }
    }
  }

  // —— VIEW-MODEL RECOIL ANIMATION FOR GUNS ——
  if (this.state.recoiling && !this.stats.isMelee) {
    const VIEWER_RECOIL_ANIM_DURATION = 0.15;
    const tR = (now - this.state.recoilStart) / VIEWER_RECOIL_ANIM_DURATION;

    if (tR >= 1) {
      const backTo = this._aiming
                   ? (this.currentKey === "marshal"
                       ? new THREE.Vector3(0.1, -0.25, -0.45)
                       : defaultAimPos)
                   : this.readyPos;
      this.viewModel.position.copy(backTo);
      this.state.recoiling = false;
    } else {
      const baseZ = this._aiming ? -0.5 : this.readyPos.z;
      const kick  = this.stats.recoilDistance * Math.sin(Math.PI * tR);
      const x     = this._aiming
                   ? (this.currentKey === "marshal" ? 0.1 : 0)
                   : this.readyPos.x;
      const y     = this._aiming ? -0.3 : this.readyPos.y;
      this.viewModel.position.set(x, y, baseZ + kick);
    }
  }

  // —— KNIFE SWING ANIMATION ——
  if (this.state.knifeSwing && this.stats.isMelee) {
    const { MathUtils } = THREE;
    const restX = MathUtils.degToRad(90),
          restY = MathUtils.degToRad(160),
          restZ = MathUtils.degToRad(0);
    const elapsed = now - this.state.knifeSwingStart;
    const dur     = this.state.knifeHeavy ? this.stats.heavySwingTime : this.stats.swingTime;

    if (elapsed >= dur) {
      this.weaponModel.rotation.set(restX, restY, restZ);
      this.state.knifeSwing = false;
    } else {
      const progress = elapsed / dur;
      const maxF     = this.state.knifeHeavy ? 0.9 : 1.2;
      const swingAng = maxF * Math.sin(Math.PI * progress);
      const sideAng  = swingAng * 0.5;
      const yOffset  = 0.5 * Math.sin(Math.PI * progress);
      this.weaponModel.rotation.set(
        restX - swingAng,
        restY + yOffset,
        restZ + sideAng
      );
    }
  }

  // Reload handling (slide animation, ammo refill)
  if (inputState.reload && !this.isReloadingFlag && this.ammoInMagazine < this.stats.magazineSize) {
    this.isReloadingFlag = true;
    this.state.reloading  = true;
    this.state.reloadStart = now;
    this._reloadEndPlayed = false;
    this.playWeaponSound("reloadStart");
  }
  if (this.state.reloading && !this.stats.isMelee) {
    const elapsed = now - this.state.reloadStart;
    const half    = this.stats.reloadDuration / 2;
    if (!this._reloadEndPlayed && elapsed >= half) {
      this.playWeaponSound("reloadEnd");
      this._reloadEndPlayed = true;
    }
    if (elapsed >= this.stats.reloadDuration) {
      this.ammoInMagazine = this.stats.magazineSize;
      this.isReloadingFlag = false;
      this.state.reloading = false;
      if (this.parts.slide) this.parts.slide.position.setZ(0);
      updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize);
    } else if (elapsed <= half) {
      const angle = (Math.PI / 180) * 40 * (elapsed / half);
      this.viewModel.rotation.x = angle;
      if (this.parts.slide) this.parts.slide.position.setZ(-0.05 * (elapsed / half));
    } else {
      const t2 = (elapsed - half) / half;
      const angle = (Math.PI / 180) * 40 * (1 - t2);
      this.viewModel.rotation.x = angle;
      if (this.parts.slide) this.parts.slide.position.setZ(-0.05 * (1 - t2));
    }
  }

  // Tracer cleanup
  this.state.tracerObjects = this.state.tracerObjects.filter(entry => {
    if (now - entry.startTime > 0.2 && entry.lineMesh.parent) {
      entry.lineMesh.parent.remove(entry.lineMesh);
      return false;
    }
    return true;
  });

  // --- Camera recoil recovery & application ---
  // Check if a recoil animation is in progress
  const elapsed = now - this._recoil.recoilStartTime;
  if (elapsed < this._recoil.recoilDuration) {
    // Calculate the animation progress
    const t = elapsed / this._recoil.recoilDuration;
    const easedT = 1 - (t * t * (3 - 2 * t)); // inverse smoothstep for a natural recovery curve
    
    // Calculate the new recoil offset based on the eased progress
    const newOffset = this._recoil.peakOffset * easedT;
    
    // Apply the recoil to the camera's rotation, using the recoveryPoint
    this.camera.rotation.x = this._recoil.recoveryPoint.x + newOffset;
  } else if (this._recoil.peakOffset > 0) {
    // Recoil animation is finished. Reset to the original recovery point.
    this.camera.rotation.copy(this._recoil.recoveryPoint);
    this._recoil.peakOffset = 0;
  }
}

  

  getCurrentAmmo() {
    return this.ammoInMagazine;
  }
  getMaxAmmo() {
    return this.stats.magazineSize;
  }
  isReloading() {
    return this.isReloadingFlag;
  }
  isMelee() {
    return this.stats.isMelee;
  }

  createPlayerArm() {
    const skinMat = createSkinMaterial("#f5be90");
    const upperGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
    const upperArm = new THREE.Mesh(upperGeom, skinMat);
    upperArm.rotation.x = Math.PI / 2;
    upperArm.position.set(0.15, -0.2, -0.2);


    const foreGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8);
    const foreArm = new THREE.Mesh(foreGeom, skinMat);
    foreArm.rotation.x = Math.PI / 2;
    foreArm.position.set(0.3, -0.35, -0.6);

  }
  
  
  


  /**
   * Performs a raycast to detect hits and handles the outcome (damage, bullet holes, tracers).
   * @param {number} spreadAngle The angle of spread to apply to the bullet's direction.
   * @param {Array<THREE.Object3D>} collidables Array of all meshes that bullets can hit (environment + players).
   */
   
// checkBulletHit: Remove sound playing logic
  checkBulletHit(origin, direction, intersectionPointOut) {
    const raycaster = new THREE.Raycaster(origin.clone(), direction.clone());
    let closest = null;

    for (const rp of Object.values(window.remotePlayers || {})) {
      const meshes = [];
      if (rp.bodyMesh) meshes.push(rp.bodyMesh);
      if (rp.headMesh) meshes.push(rp.headMesh);

      for (const mesh of meshes) {
        if (!mesh.geometry.boundsTree) continue;
        const hits = raycaster.intersectObject(mesh, true);
        if (!hits.length) continue;
        const hit = hits[0];
        if (!closest || hit.distance < closest.distance) {
          closest = {
            mesh,
            isHead: mesh.userData.isPlayerHead === true,
            intersection: hit.point.clone(),
            distance: hit.distance
          };
        }
      }
    }

    if (!closest) return null;
    if (intersectionPointOut instanceof THREE.Vector3) {
      intersectionPointOut.copy(closest.intersection);
    }
    return {
      mesh: closest.mesh,
      isHead: closest.isHead,
      intersection: closest.intersection.clone(),
      distance: closest.distance
    };
  }

  checkBulletPenetration(origin, direction, maxWorldPenetrations = 1) {
    if (!this.physicsController.worldBVH || !this.physicsController.collider) {
      console.error("World BVH or collider mesh not available.");
      return { playerHitResult: null, allWorldHits: [], penetrationCount: 0, isPenetrationShot: false };
    }

    let currentOrigin = origin.clone();
    let worldPenetrationCount = 0;
    const allWorldHits = [];
    let playerHitResult = null;

    for (let i = 0; i <= maxWorldPenetrations; i++) {
      const raycaster = new THREE.Raycaster(currentOrigin.clone(), direction.clone());
      const worldHits = raycaster.intersectObject(this.physicsController.collider, true);
      const worldIntersection = worldHits.length ? worldHits[0] : null;
      const playerHit = this.checkBulletHit(currentOrigin, direction);

      let closestHit, hitType;
      if (worldIntersection && (!playerHit || worldIntersection.distance <= playerHit.distance)) {
        closestHit = worldIntersection;
        hitType = 'world';
      } else if (playerHit) {
        closestHit = playerHit;
        hitType = 'player';
      } else break;

      if (hitType === 'player') {
        playerHitResult = {
          mesh: closestHit.mesh,
          isHead: closestHit.isHead,
          intersection: closestHit.intersection.clone(),
          distance: origin.distanceTo(closestHit.intersection)
        };
        break;
      }

      // world hit
      worldPenetrationCount++;
      const normal = (closestHit.face && closestHit.object)
        ? closestHit.face.normal.clone().transformDirection(closestHit.object.matrixWorld).normalize()
        : direction.clone().negate();

      allWorldHits.push({
        point: closestHit.point.clone(),
        normal,
        distance: currentOrigin.distanceTo(closestHit.point),
        object: closestHit.object
      });

      if (worldPenetrationCount > maxWorldPenetrations) break;
      currentOrigin.copy(closestHit.point).add(direction.clone().multiplyScalar(0.01));
    }

    return {
      playerHitResult,
      allWorldHits,
      penetrationCount: worldPenetrationCount,
      isPenetrationShot: !!(playerHitResult && worldPenetrationCount > 0)
    };
  }

fireBullet(spreadAngle) {
  if (!this.physicsController.worldBVH) {
    console.error("World BVH not available to fire bullet.");
    return;
  }

  // 1) Compute origin & direction
  this.camera.updateMatrixWorld();
  const origin    = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
  const direction = getSpreadDirection(spreadAngle, this.camera);

  // 2) Raycast world+players with penetration
  const traj = this.checkBulletPenetration(origin, direction, 1);

  // 3) If we ended up hitting a player…
  if (traj.playerHitResult) {
    const hit    = traj.playerHitResult;
    const mesh   = (() => {
      let m = hit.mesh;
      while (m && m.userData.playerId == null) m = m.parent;
      return m;
    })();
    if (mesh && mesh.userData.playerId != null) {
      const isHead          = hit.isHead;
      const baseDamage      = isHead ? this.stats.headshotDamage : this.stats.bodyDamage;
      // halve damage on penetration
      const damageToApply   = baseDamage * (traj.isPenetrationShot ? 0.5 : 1.0);

      window.applyDamageToRemote?.(
        mesh.userData.playerId,
        damageToApply,
        {
          id: this.localPlayerId,
          username: window.localPlayer?.username ?? "Unknown",
          weapon: this.currentKey,
          isHeadshot: isHead,
          isPenetrationShot: traj.isPenetrationShot
        }
      );

      // play sound
      traj.isPenetrationShot
        ? playBodyHit()                    // still body‐hit sound if it went through
        : (isHead ? playBodyHeadshot() 
                  : playBodyHit());
    }

    // tracer end is the player intersection
    var tracerEnd = hit.intersection;
  } else {
    // 4) No player hit, tracer ends at last world hit or max range
    if (traj.allWorldHits.length) {
      tracerEnd = traj.allWorldHits[traj.allWorldHits.length - 1].point;
    } else {
      tracerEnd = origin.clone().add(direction.clone().multiplyScalar(this.stats.tracerLength));
    }
  }

  // 5) Bullet‐hole decals
  for (const wh of traj.allWorldHits) {
    sendBulletHole({
      x: wh.point.x,   y: wh.point.y,   z: wh.point.z,
      nx: wh.normal.x, ny: wh.normal.y, nz: wh.normal.z,
      timeCreated: firebase.database.ServerValue.TIMESTAMP
    });
  }

  // 6) Draw tracer & network
  const muzzlePos = this.parts.muzzle
    ? this.parts.muzzle.getWorldPosition(new THREE.Vector3())
    : origin;
  this.createTracer(muzzlePos, tracerEnd, this.currentKey, this.stats.tracerLength);
  sendTracer({
    ox: muzzlePos.x, oy: muzzlePos.y, oz: muzzlePos.z,
    tx: tracerEnd.x, ty: tracerEnd.y, tz: tracerEnd.z
  });
}


checkMeleeHit(collidables) {
  const nowMs   = performance.now();
  const { rpm, bodyDamage } = WeaponController.WEAPONS.knife;
  const interval = 60000 / rpm;
  if (nowMs - this._lastKnifeSwingTime < interval) return;
  this._lastKnifeSwingTime = nowMs;

  const meleeRange  = 3;
  const meleeDamage = bodyDamage;
  const playerPos   = new THREE.Vector3();
  this.camera.getWorldPosition(playerPos);

  for (const obj of collidables) {
    if (obj.userData?.isPlayerBodyPart && obj.userData.playerId !== this.localPlayerId) {
      const targetGroup = window.remotePlayers[obj.userData.playerId]?.group;
      if (!targetGroup) continue;

      const targetPos = new THREE.Vector3();
      targetGroup.getWorldPosition(targetPos);

      if (playerPos.distanceTo(targetPos) <= meleeRange) {
      //  console.log(`🗡️ Knife hit player ${obj.userData.playerId}`);
        window.applyDamageToRemote?.(
          obj.userData.playerId,
          meleeDamage,
          { id: this.localPlayerId, username: window.localPlayer?.username ?? "Unknown", weapon: "knife" }
        );
        return;
      }
    }
  }
}


buildKnife(onProgressRegistrar) {
    const loader = new GLTFLoader();
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/karambitf.glb';
    let prog = () => {};
    const promise = new Promise((res, rej) => {
      loader.load(
        url,
        gltf => {
          this.weaponModel = new THREE.Group();
          this.parts = {};
          if (this.viewModel) this.viewModel.add(this.weaponModel);
          const model = gltf.scene;

          // Remove or comment out all the material creation and assignment:
          // const bladeMat = createMetalMaterial(0xffffff);
          // const handleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
          // const fingerRestMat = createMetalMaterial(0xffffff);
          // const decoMat = createMetalMaterial(0xff0000);
          // const defaultMat = new THREE.MeshStandardMaterial({ color: 0x999999 });

          model.traverse(child => {
            if (!child.isMesh) return;

            // Remove or comment out this entire block that reassigns materials
            // const name = child.name.toLowerCase();
            // let mat = defaultMat;
            // if (name.includes('ahva')) mat = handleMat;
            // else if (name.includes('koriste')) mat = decoMat;
            // else if (name.includes('sormensi')) mat = fingerRestMat;
            // else if (name.includes('ater')) mat = bladeMat;
            // child.material = mat; // This line is the one overriding the GLB's material
            // child.geometry.computeVertexNormals(); // May still be useful, but related to geometry not material
            // child.material.needsUpdate = true; // This is only needed if you change the material

            // Keep these lines to assign parts if needed for other logic (e.g., animations)
            const name = child.name.toLowerCase(); // Keep this to identify parts
            if (name.includes('ater')) this.parts.blade = child;
            if (name.includes('sormensi')) this.parts.ring = child;
            if (name.includes('ahva')) this.parts.handle = child;
          });

          // The rest of your code remains largely the same for positioning and scaling
          const bbox = new THREE.Box3().setFromObject(model);
          const center = bbox.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const size = bbox.getSize(new THREE.Vector3());
          const s = 0.5 / Math.max(size.x, size.y, size.z);
          this.weaponModel.scale.set(s, s, s);

          this.weaponModel.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.weaponModel.add(model);
          this.weaponModel.rotation.set(
            THREE.MathUtils.degToRad(90),
            THREE.MathUtils.degToRad(160),
            0
          );
          this.weaponModel.position.set(0.5, -0.1, -0.7);
          res(this.weaponModel);
        },
        evt => { if (evt.lengthComputable) prog(evt); },
        err => rej(err)
      );
    });
    return { promise, register: cb => prog = cb };
}

addDebugMuzzleDot(muzzleObject3D, dotSize = 0.5) {
        const geometry = new THREE.SphereGeometry(dotSize, 8, 8); // Small sphere
        const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Bright red
        const debugDot = new THREE.Mesh(geometry, material);
        debugDot.name = 'DebugMuzzleDot';
        
        // Add it to the muzzle Object3D, so it moves with the muzzle
        muzzleObject3D.add(debugDot);
    }

    buildDeagle(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/desert-eagle_gun.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    if (this.viewModel) this.viewModel.add(this.weaponModel);
                    const model = gltf.scene;
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(5, 5, 5);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(7),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15 * (sw/1920),
                        0.1 * (sh/1080),
                        -0.1 * (sw/1920)
                    );
                    const box2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // These coordinates are relative to the 'model's' local space after centering
                    // You'll likely need to adjust these values (`-box2.max.x, box2.max.y, 1`)
                    // until the debug dot appears at the very tip of your gun's muzzle.
                    muzzle.position.set(-box2.max.x, box2.max.y, 1); 
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }

    buildAK47(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/leave_a_like__ak47_game_ready_free.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    const metalM = createMetalMaterial(0x888888);
                    const woodM = createWoodMaterial(0x8B4513);
                    const plasticM = createPlasticMaterial(0x666666);
                    const model = gltf.scene;
                    model.traverse(child => {
                        if (!child.isMesh) return;
                        const nm = child.name.toLowerCase();
                        child.material = (nm.includes('wood')||nm.includes('stock')||nm.includes('handguard'))
                            ? woodM
                            : (nm.includes('grip')||nm.includes('handle'))
                                ? plasticM
                                : metalM;
                    });
                    const before = new THREE.Box3().setFromObject(model);
                    const center = before.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    const after = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // Adjust these values until the debug dot appears at the very tip.
                    muzzle.position.set(-after.max.x + 0.5, after.max.y, 1.6);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(0.4,0.4,0.4);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(4),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.35*(sw/1920),
                        -0.15*(sh/1080),
                        -0.3*(sw/1920)
                    );
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;
                    if (this.viewModel) this.viewModel.add(this.weaponModel);

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }

    buildMarshal(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/svd_sniper_rfile.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    const woodM = createWoodMaterial(0x8B4513);
                    const metalM = createMetalMaterial(0x888888);
                    const plasticM = createPlasticMaterial(0x666666);
                    const defaultM = createMetalMaterial(0x555555);
                    const model = gltf.scene;
                    model.children.forEach((child,i) => {
                        if (!child.isMesh) return;
                        const mats = [woodM, metalM, plasticM, metalM];
                        child.material = mats[i]||defaultM;
                        child.geometry.computeVertexNormals();
                        child.material.needsUpdate = true;
                    });
                    const b1 = new THREE.Box3().setFromObject(model);
                    const center = b1.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    const b2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // Adjust these values until the debug dot appears at the very tip.
                    muzzle.position.set(0, b2.max.y, -b2.max.z); 
                    model.add(muzzle);
                    this.parts.muzzle = muzzle;
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(1,1,1);
                    this.weaponModel.rotation.set(0,0,0);
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15*(sw/1920),
                        0.15*(sh/1080),
                        -0.1*(sw/1920)
                    );
                    if (this.viewModel) this.viewModel.add(this.weaponModel);

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }
    buildM79(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/M-79.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    if (this.viewModel) this.viewModel.add(this.weaponModel);
                    const model = gltf.scene;
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(5, 5, 5);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(7),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15 * (sw/1920),
                        0.1 * (sh/1080),
                        -0.1 * (sw/1920)
                    );
                    const box2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // These coordinates are relative to the 'model's' local space after centering
                    // You'll likely need to adjust these values (`-box2.max.x, box2.max.y, 1`)
                    // until the debug dot appears at the very tip of your gun's muzzle.
                    muzzle.position.set(-box2.max.x, box2.max.y, 1); 
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }
  
}



export async function preloadWeaponPrototypes(onComplete) {
  const names = ['knife','deagle','ak47','marshal','m79',];
  const dummyCam = new THREE.Group();
  const loaderUI = new Loader();
  const itemPercentages = names.map(() => 1 / names.length);

  loaderUI.show('Loading...', itemPercentages);
  loaderUI.onComplete(() => {
    console.log('▶️ ALL weapon prototypes ready');
    onComplete?.();
  });

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const wc = new WeaponController(dummyCam);
    const method = 'build' + (name === 'ak47' ? 'AK47' : name[0].toUpperCase() + name.slice(1));
    console.log(`Preloading ${name}, weight ${itemPercentages[i] * 100}%`);

    // get { promise, register } from buildX()
    const { promise, register } = wc[method]();
    // track with live progress
    await loaderUI.track(itemPercentages[i], promise, cb => register(cb));
    // post-load housekeeping
    const model = await promise;
    dummyCam.remove(model);
    model.visible = false;
    _prototypeModels[name] = model;
    console.log(`Loaded ${name}`);
  }
}


// Call once at startup:
preloadWeaponPrototypes(() => {
  console.log("✅ All prototypes including knife have been preloaded!");
  // Now it's safe to start letting players swap weapons.
});

// factory to clone
export function getWeaponModel(name) {
  const proto = _prototypeModels[name];
  if (!proto) {
    console.warn(`No prototype for weapon ${name}`);
    return new THREE.Group();
  }
  return proto.clone(true);
}

let debugLogElement;



export const activeTracers = []; // <--- EXPORT THIS!

export class AnimatedTracer extends THREE.Mesh {
    constructor(origin, target, speed = 500) { // Increased default speed significantly
        // --- NEW GEOMETRY: BoxGeometry for a long rectangle ---
        // Parameters: width, height, depth (along Z-axis for alignment)
        // Adjust these values to get the desired look.
        // width and height are small for a thin line.
        // depth is the length of the tracer.
        const tracerLength = 20; // Length of the tracer visual
        const tracerWidth = 0.05; // Thickness of the tracer
        const tracerHeight = 0.05; // Thickness of the tracer

        const geometry = new THREE.BoxGeometry(tracerWidth, tracerHeight, tracerLength); 

        const material = new THREE.MeshBasicMaterial({
            color: 0xffa500, // Orange-ish color for visibility
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            // --- MODIFICATION: Set depthTest and depthWrite to true ---
            depthTest: true, // Allow depth testing
            depthWrite: true // Allow writing to the depth buffer
        });

        super(geometry, material);

        this.initialOrigin = origin.clone(); // Store initial origin for direction and rotation
        this.target = target.clone();
        this.direction = new THREE.Vector3().subVectors(target, origin).normalize();
        this.distance = origin.distanceTo(target);
        this.speed = speed; // Use the passed-in speed (default is now 500)
        this.traveledDistance = 0;
        this.initialOpacity = 1.0;
        this.remove = false;

        // --- NEW: Position and Orient the tracer correctly ---
        // Calculate the midpoint of the tracer's travel path for initial placement
        const midpoint = new THREE.Vector3().addVectors(origin, target).multiplyScalar(0.5);
        this.position.copy(origin); // Start tracer at the origin

        // Orient the tracer along its travel direction
        const tempQuaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0); // Assuming Y is up
        tempQuaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction); // Z-axis of box points to target
        this.rotation.setFromQuaternion(tempQuaternion);

        // Adjust position so the *start* of the tracer is at the origin
        // The BoxGeometry is centered at its origin (0,0,0), so we need to offset it
        // by half its length along its local Z-axis (which now points in 'direction')
        this.position.addScaledVector(this.direction, 5);

        if (window.scene) {
            window.scene.add(this);
        } else {
            console.error("THREE.js scene not found. Cannot add tracer.");
        }
        
        activeTracers.push(this);
    }

    update(deltaTime) {
        if (this.traveledDistance < this.distance) {
            const moveAmount = this.speed * deltaTime;
            
            // Move the tracer along its direction vector
            // We move it by `moveAmount` which updates its current position relative to its initial point.
            this.position.addScaledVector(this.direction, moveAmount);
            this.traveledDistance += moveAmount;

            // Optional: Fade out as it approaches the target
            const remainingDistance = this.distance - this.traveledDistance;
            const fadeOutStartDistance = this.speed * 0.01; // Fade out over a very short time, proportional to speed
            if (remainingDistance < fadeOutStartDistance) { 
                this.material.opacity = this.initialOpacity * (remainingDistance / fadeOutStartDistance);
            }
            this.material.opacity = Math.max(0, this.material.opacity); 

        } else {
            this.remove = true;
        }
    }

    dispose() {
        if (this.parent) {
            this.parent.remove(this);
        }
        this.geometry.dispose();
        this.material.dispose();
    }
}
