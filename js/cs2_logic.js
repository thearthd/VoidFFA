// js/cs2_logic.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
export const RECOIL_PATTERN = {
  "ak-47": [
    0.003, 0.005, 0.006, 0.007, 0.008, 0.009, 0.005, 0.005, 0.005,
    0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005,
    0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005,
  ],
  deagle: [0.025],
  marshal: [0.055],
  m79: [0.010],
};

export const ADS_FOV = {
  default: 75,
  deagle: 50,
  ak47: 60,
  marshal: 10,
  m79: 70,
};

/**
 * Calculates the half-angle (in radians) of the spread cone for a given weapon and state.
 * For AK-47, the spread progressively increases with each shot, following its recoil pattern.
 *
 * @param {string} weaponKey
 * @param {THREE.Vector3} velocity       – full horizontal movement vector
 * @param {boolean} isCrouched
 * @param {boolean} isAiming
 * @param {boolean} isGrounded
 * @param {number} shotIndex            – current shot number in a burst/sequence (0-indexed)
 * @returns {number} half-angle (in radians) of spread cone
 */
export function getSpreadMultiplier(
  weaponKey,
  velocity,
  isCrouched,
  isAiming,
  isGrounded,
  shotIndex = 0 // Default to 0 for single shots or weapons not needing this
) {
  const isAirborne = !isGrounded;
  const speed = velocity.length();

  // Weapon-specific base values for spread angles (in radians) and factors
  let standingBase, runBase, airBase, crouchFactor, runThreshold, aimFactor;
  switch (weaponKey) {
    case "ak-47":
      standingBase = 0.01; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.1; runThreshold = 4; aimFactor = 0.25;
      break;
    case "deagle":
      standingBase = 0.01; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "marshal":
      standingBase = 0.1; runBase = 0.15; airBase = 0.2;
      crouchFactor = 0.40; runThreshold = 4; aimFactor = 0.01;
      break;
    case "m79":
      standingBase = 0.05; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "mp5":
      standingBase = 0.3; runBase = 1; airBase = 1.1;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "sniper":
      standingBase = 0.2; runBase = 1; airBase = 0.15;
      crouchFactor = 0.40; runThreshold = 4; aimFactor = 0.00001;
      break;
    default:
      standingBase = 0.02; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
  }

  // Calculate the base spread angle based on movement state
  let currentSpreadAngle;
  if (speed <= 3 && isGrounded) {
    currentSpreadAngle = standingBase;
  } else if (isAirborne) {
    currentSpreadAngle = airBase;
  } else if (speed > runThreshold) {
    currentSpreadAngle = runBase;
  } else {
    // Interpolate between standing and running spread based on speed
    const t = Math.min(speed / runThreshold, 1);
    currentSpreadAngle = standingBase * (1 - t) + runBase * t;
  }

  // Apply crouch and aim factors as multipliers to the current spread angle
  if (isCrouched) currentSpreadAngle *= crouchFactor;
  if (isAiming) currentSpreadAngle *= aimFactor;

  // Apply extra airborne penalty as a multiplier
  if (isAirborne) currentSpreadAngle *= (airBase * 10);

  // --- AK-47 Progressive Inaccuracy based on Recoil Pattern ---
  if (weaponKey === "ak-47") {
    // Get the recoil angle for the current shot from the RECOIL_PATTERN
    const recoilPatternValue = getRecoilAngle(weaponKey, shotIndex);

    // Add a scaled portion of the recoil pattern value to the spread angle.
    // The '0.5' is a scaling factor. Adjust this value to control how much
    // the recoil pattern's magnitude directly influences the bullet spread.
    // A value of 1 means the spread increases by the exact recoil angle for that shot.
    // A smaller value means less contribution, making the AK-47 less punishing.
    currentSpreadAngle += recoilPatternValue * 1;
  }

  return currentSpreadAngle;
}

/**
 * @param {number} spreadAngle
 * @param {THREE.Camera} camera
 * @returns {THREE.Vector3}
 */
export function getSpreadDirection(spreadAngle, camera) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward).normalize();
  if (spreadAngle === 0) return forward;
  const up = camera.up.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const yawOff = (Math.random() * 2 - 1) * spreadAngle;
  return forward.clone()
    .add(right.multiplyScalar(Math.tan(yawOff)))
    .normalize();
}

/**
 * @param {string} weaponKey
 * @param {number} shotIndex
 * @returns {number}
 */
export function getRecoilAngle(weaponKey, shotIndex) {
  const pattern = RECOIL_PATTERN[weaponKey];
  if (!pattern) return 0;
  // Ensure we don't go out of bounds of the pattern array
  return pattern[Math.min(shotIndex, pattern.length - 1)];
}
