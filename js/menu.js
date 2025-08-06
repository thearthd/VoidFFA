// menu.js

/*
     _____,,;;;`;        ;';;;,,_____
,~(  )  , )~~\ |        |/~( ,  (  )~;
' / / --`--,          .--'-- \ \ `
  /  \    | '          ` |    /  \
// fff fff f f fffffff f
horse power
*/

// --- All imports moved to the top ---
// IMPORTANT: Ensure firebase-config.js is loaded BEFORE this script in your HTML
// or that `gamesRef` is otherwise globally accessible.
// For CodeHS, if files are concatenated, the order in the project matters.
// import { gamesRef } from "./firebase-config.js"; // This line is for modular JS.
// In a typical CodeHS setup, you might rely on global variables or ensure firebase-config runs first.
// If not, you may need to explicitly define it here using `firebase.app("menuApp").database().ref("games")`
// provided `firebase` SDK is loaded.
// f
// f
// f
// If `gamesRef` is not automatically global, uncomment and use this (requires Firebase SDK loaded):
// const gamesRef = firebase.app("menuApp").database().ref("games");

import { addChatMessage } from "./ui.js";   // wherever you keep your chat helpers
const CLIENT_GAME_VERSION = "v1.00";
// Placeholder for external imports, adjust paths as needed
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createGameUI, initBulletHoles } from "./ui.js";
import { startGame, toggleSceneDetails } from "./game.js";
import { initNetwork, setActiveGameId } from "./network.js";
import { gamesRef, claimGameSlot, releaseGameSlot, slotsRef, usersRef, requiredGameVersion, assignPlayerVersion, menuChatRef, } from './firebase-config.js';
import { setPauseState, inputState, currentKeybinds } from "./input.js";
import {  showLoadoutScreen, hideLoadoutScreen } from "./loadout.js";
// Make sure you have this script tag in your HTML <head> or before your menu.js script:
// <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

// --- Start of engine.js content (included here as per your provided code) ---
function playButtonHover() {
     let buttonHover = new Audio("https://codehs.com/uploads/773375a846afc175b34b2eff70e8d947");
     buttonHover.volume = 0.3;
     buttonHover.play();
}

function playButtonClick() {
     let buttonClick = new Audio("https://codehs.com/uploads/0e6b3db8eba47ff22199d98eda64cdac");
     buttonClick.volume = 1;
     buttonClick.play();
}
     
// Export utility functions and classes
export const preload = src => {
    const img = new Image();
    img.src = src;
};

let dbRefs = {};
let dontyetpls = 0;

// Get the canvas element and its 2D rendering context
const canvas = document.getElementById('menuCanvas');
const ctx = canvas.getContext('2d');

const sensitivitySliderContainer = document.getElementById("sensitivity-slider-container");
const settingsBox = document.getElementById("settings-box");

    const sensitivityRange = document.getElementById("sensitivity-range");
    const sensitivityInput = document.getElementById("sensitivity-input");

const menuBG = document.getElementById("animatedBG");
  const hud = document.getElementById("hud");

const loadMenu = document.getElementById("loading-menu");

let canvasWidth = canvas.width;
let canvasHeight = canvas.height;

let menuSong = new Audio("https://codehs.com/uploads/7ab8d31b9bb147e3952841963f6f3769");
menuSong.volume = 0.4;
menuSong.loop = true;

/**
 * Sets the canvas dimensions to a fixed size (1920x1080) and updates
 * the global canvasWidth and canvasHeight variables.
 */
function setCanvasDimensions() {
    canvas.width = 1920;
    canvas.height = 1080;

    canvasWidth = canvas.width;
    canvasHeight = canvas.height;
}

// Call initially to set up canvas dimensions
setCanvasDimensions();

const clickableShapes = []; // Array to store shapes that respond to clicks

/**
 * Returns the current width of the canvas.
 * @returns {number} The canvas width.
 */
export function getWidth() { return canvasWidth; }

/**
 * Returns the current height of the canvas.
 * @returns {number} The canvas height.
 */
export function getHeight() { return canvasHeight; }

// const HOLD_RELEASE_GRACE_PERCENT = 0.80; // This variable was not used in the original engine.js

// List of shapes to draw on the canvas
const shapes = [];

/**
 * Adds a shape to the drawing list.
 * @param {Shape} shape - The shape object to add.
 */
export function add(shape) {
    shapes.push(shape);
}

/**
 * Removes a shape from the drawing list.
 * @param {Shape} shape - The shape object to remove.
 */
export function remove(shape) {
    const index = shapes.indexOf(shape);
    if (index > -1) {
        shapes.splice(index, 1);
    }
}

/**
 * Removes all shapes from the drawing list.
 * This now also clears all clickable shapes/hitboxes.
 */
export function removeAll() {
    shapes.length = 0; // Clears shapes for drawing
    clickableShapes.length = 0; // Clears hitboxes for interaction
}

/**
 * Base class for all drawable shapes.
 */
export class Shape {
    constructor() {
        this.layer = 0; // Drawing order (higher layers draw on top)
        this.opacity = 1.0; // Transparency (0.0 to 1.0)
        this.hovered = false; // Internal state for hover detection
        this.onHover = null;    // Callback function when mouse hovers over shape
        this.onUnhover = null; // Callback function when mouse leaves shape
    }

    /**
     * Sets the opacity of the shape.
     * @param {number} o - The opacity value (0.0 to 1.0).
     */
    setOpacity(o) { this.opacity = o; }

    /**
     * Sets the drawing layer of the shape. Shapes with higher layers are drawn on top.
     * @param {number} l - The layer value.
     */
    setLayer(l) { this.layer = l; }
}

/**
 * Represents a circle shape.
 */
export class Circle extends Shape {
    constructor(radius) {
        super();
        this.radius = radius;
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.borderColor = null;
        this.borderWidth = 0;
        this.anchorX = 0;    // Default: top-left (0 for horizontal) - not typically used for circles
        this.anchorY = 0; // not typically used for circles
    }

    /**
     * Sets the radius of the circle.
     * @param {number} r - The new radius.
     */
    setRadius(r) {
        this.radius = r;
    }

    /**
     * Sets the position of the circle's center.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for circle drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /**
     * Sets the fill color of the circle.
     * @param {string} color - The color string (e.g., 'red', '#FF0000').
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Sets the border color of the circle.
     * @param {string} color - The color string.
     */
    setBorderColor(color) {
        this.borderColor = color;
    }

    /**
     * Sets the width of the circle's border.
     * @param {number} w - The border width in pixels.
     */
    setBorderWidth(w) {
        this.borderWidth = w;
    }

    /** @returns {number} The x-coordinate of the circle's center. */
    getX() { return this.x; }
    /** @returns {number} The y-coordinate of the circle's center. */
    getY() { return this.y; }
    /** @returns {number} The radius of the circle. */
    getRadius() { return this.radius; }

    /**
     * Moves the circle by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Draws the circle on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
        ctx.fillStyle = this.color;
        ctx.fill();
        if (this.borderWidth > 0) {
            ctx.lineWidth = this.borderWidth;
            ctx.strokeStyle = this.borderColor || 'black';
            ctx.stroke();
        }
        ctx.restore();
    }
}

/**
 * Represents a rectangle shape.
 */
export class Rectangle extends Shape {
    constructor(width, height) {
        super();
        this.width = width;
        this.height = height;
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
    }

    /**
     * Sets the position of the rectangle's top-left corner.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets the fill color of the rectangle.
     * @param {string} color - The color string.
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for rectangle drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /**
     * Sets the width and height of the rectangle.
     * @param {number} width - The new width.
     * @param {number} height - The new height.
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }

    /** @returns {number} The x-coordinate of the rectangle's top-left corner. */
    getX() { return this.x; }
    /** @returns {number} The y-coordinate of the rectangle's top-left corner. */
    getY() { return this.y; }
    /** @returns {number} The width of the rectangle. */
    getWidth() { return this.width; }
    /** @returns {number} The height of the rectangle. */
    getHeight() { return this.height; }

    /**
     * Moves the rectangle by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Draws the rectangle on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.restore();
    }
}

/**
 * Represents a text shape.
 */
export class Text {
    constructor(text, font) {
        this.text = text;
        this.font = font || '16pt Tahoma';
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.layer = 0;
        this.opacity = 1.0;
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
        this.originalFontSize = 0; // Added this property as it was in the original code
    }

    /**
     * Moves the text by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Sets the opacity of the text.
     * @param {number} o - The opacity value (0.0 to 1.0).
     */
    setOpacity(o) {
        this.opacity = o;
    }

    /**
     * Sets the position of the text.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets the color of the text.
     * @param {string} color - The color string.
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Sets the text content.
     * @param {string} text - The new text string.
     */
    setText(text) {
        this.text = text;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for text drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /** @returns {number} The x-coordinate of the text. */
    getX() { return this.x; }
    /** @returns {number} The y-coordinate of the text. */
    getY() { return this.y; }

    /**
     * Sets the drawing layer of the text.
     * @param {number} l - The layer value.
     */
    setLayer(l) { this.layer = l; }

    /**
     * Calculates and returns the width of the text.
     * This method requires a CanvasRenderingContext2D to accurately measure text.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     * @returns {number} The width of the text in pixels.
     */
    getWidth(ctx) {
        if (!ctx) {
            console.warn("Text.getWidth() called without a CanvasRenderingContext2D. Cannot accurately measure text width.");
            // Fallback: return a rough estimate or 0, depending on desired behavior
            // For now, returning 0 to highlight the need for ctx.
            return 0;
        }
        ctx.save(); // Save the current context state
        ctx.font = this.font; // Set the font for accurate measurement
        const metrics = ctx.measureText(this.text);
        ctx.restore(); // Restore the context state
        return metrics.width;
    }

    /**
     * Calculates and returns the height of the text.
     * This method requires a CanvasRenderingContext2D to accurately measure text.
     * Note: Text height can be more complex than width. This uses common metrics.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     * @returns {number} The height of the text in pixels.
     */
    getHeight(ctx) {
        if (!ctx) {
            console.warn("Text.getHeight() called without a CanvasRenderingContext2D. Cannot accurately measure text height.");
            return 0;
        }
        ctx.save();
        ctx.font = this.font;
        const metrics = ctx.measureText(this.text);
        ctx.restore();
        // A common way to estimate height is ascent + descent.
        // If these properties are not available or if a simpler estimate is needed,
        // you might infer from font size or use a fixed line height.
        if (metrics.actualBoundingBoxAscent && metrics.actualBoundingBoxDescent) {
            return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        }
        // Fallback: A very rough estimate based on font size (e.g., 1.2 times font size)
        // This requires parsing the font string, which can be complex.
        // For simplicity, if bounding box metrics aren't available, we might return 0
        // or a default value, or you might need a more robust font size parser.
        // Given the context, '20pt Arial' implies a standard font, so bounding box should work.
        return 0; // Or a more sophisticated fallback if needed
    }

    /**
     * Draws the text on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.font = this.font;
        ctx.textAlign = 'center'; // Your original code sets this, so keep it for drawing
        ctx.textBaseline = 'middle'; // Your original code sets this, so keep it for drawing
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
}


/**
 * Represents an image shape.
 */
export class ImageShape extends Shape {
    constructor(src, onLoadCallback = null) {
        super();
        this.image = new Image();
        this.image.src = src;
        this.image.onload = () => {
            this.loaded = true;
            if (onLoadCallback) onLoadCallback(); // Trigger callback once image is loaded
        };
        this.loaded = false;

        this.x = 0;
        this.y = 0;
        this.width = 100;
        this.height = 100;
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
        this.opacity = 1.0;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for image drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /**
     * Sets the width and height of the image.
     * @param {number} width - The new width.
     * @param {number} height - The new height.
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }

    /**
     * Moves the image by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Sets the position of the image's top-left corner.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /** @returns {number} The width of the image. */
    getWidth() { return this.width; }
    /** @returns {number} The height of the image. */
    getHeight() { return this.height; }

    setOpacity(o) { this.opacity = o; }
     
    /**
     * Draws the image on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        if (!this.loaded) return; // Skip drawing until image is loaded
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
        ctx.restore();
    }
}

/**
 * The main game loop that clears the canvas, sorts and draws all shapes,
 * and then requests the next animation frame.
 */
function gameLoop() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    // Sort and draw shapes by layer to ensure correct rendering order
    shapes.sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let shape of shapes) {
        if (shape.draw) { // Ensure the shape has a draw method
            shape.draw(ctx);
        }
    }
    requestAnimationFrame(gameLoop);
}

// Start the game loop
requestAnimationFrame(gameLoop);

/**
 * Makes a shape clickable by associating it with an onClick callback.
 * Stores the shape and its click handler in the clickableShapes array.
 * @param {Shape} shape - The shape to make clickable (its hitbox).
 * @param {Function} onClick - The function to call when the shape is clicked.
 */
export function makeButton(shape, onClick) {
    // This is the core change: we store the onClick handler directly within
    // the entry object that goes into clickableShapes.
    // The shape itself will also have onHover/onUnhover set by createAnimatedButton.
    clickableShapes.push({ shape, onClick });
}

// Event listener for mouse clicks on the canvas
canvas.addEventListener("click", function (event) {
    const rect = canvas.getBoundingClientRect();
    // Calculate scaling factors to convert CSS pixels to canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get click coordinates in canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // Check if the click occurred within any clickable shape
    for (const entry of clickableShapes) {
        const s = entry.shape; // s is the hitbox object
        let isHit = false;

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            isHit = inX && inY;
        }
        else if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            isHit = Math.sqrt(dx * dx + dy * dy) <= s.getRadius();
        }
        else if (s instanceof ImageShape) { // Assuming ImageShape can also be a hitbox
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            isHit = inX && inY;
        }

        if (isHit) {
            // Ensure entry.onClick is actually a function before calling it
            if (typeof entry.onClick === 'function') {
                entry.onClick(); // Trigger the click callback stored in the entry
                break; // Stop after the first hit
            } else {
                console.error("Found clickable entry without a valid onClick function:", entry);
            }
        }
    }
});

canvas.addEventListener("mousemove", function (event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Convert from CSS pixels into canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    let hoveringAny = false; // Flag to track if mouse is hovering over any clickable shape

    for (const entry of clickableShapes) {
        const s = entry.shape;
        let isHovering = false;

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            isHovering = inX && inY;
        }
        else if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            isHovering = dx * dx + dy * dy <= s.getRadius() * s.getRadius();
        }
        else if (s instanceof ImageShape) { // Assuming ImageShape can also be a hitbox
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            isHovering = inX && inY;
        }

        if (isHovering) hoveringAny = true;

        // Handle hover state callbacks
        // These callbacks (onHover, onUnhover) are still stored directly on the Shape object itself (s)
        if (isHovering && !s.hovered) {
            s.hovered = true;
            if (s.onHover) s.onHover();
        } else if (!isHovering && s.hovered) {
            s.hovered = false;
            if (s.onUnhover) s.onUnhover();
        }
    }

    // Change cursor style based on hover state
    canvas.style.cursor = hoveringAny ? "pointer" : "default";
});

/**
 * Displays a GIF as a background element on the document body.
 * @param {string} src - The URL of the GIF.
 */
export function showGifBG(src) {
    const gif = document.createElement("img");
    gif.src = src;
    gif.id = "animatedBG";
    Object.assign(gif.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "800px",
        height: "800px",
        zIndex: "0"
    });
    document.body.appendChild(gif);
}

/**
 * Removes the animated GIF background if it exists.
 */
export function removeGifBG() {
    const gif = document.getElementById("animatedBG");
    if (gif) gif.remove();
}

// --- End of engine.js content ---


// --- Start of myMenu.js content ---

// Global window properties related to Three.js (as defined in original myMenu.js)
window.scene = new THREE.Scene();
window.renderer = {
    shadowMap: { enabled: true },
    setClearColor: () => { } // Placeholder function
};
window.dirLight = null;
window.originalFogParams = {
    type: "exp2",
    color: 0x87ceeb,
    density: 0.05,
    near: 1,
    far: 1000
};
window.originalBloomStrength = 3;
window.bloomPass = null;


let color = "#ff4444"; // Unused variable in the provided context

let inMenu = true; // Flag to indicate if the menu is active
let leftbuttonSpacing = 150; // Spacing for menu buttons

// Main logo image for the menu
let logo = new ImageShape("https://codehs.com/uploads/8b490deb914374d0ca27f9ab21fac591");
logo.setSize(1920/16, 1920/16); // Adjusted size for better visibility
logo.setPosition(getWidth() / 2 - logo.getWidth() / 2, getHeight() / 32);
logo.setLayer(10); // Ensure logo is drawn on top

// Background rectangle for the menu
let background = new Rectangle(getWidth(), getHeight());
background.setLayer(1); // Drawn behind other elements
background.setColor("#222222");

const TARGET_SCALE_FACTOR = 1.1; // Scale up to 110% on hover for text (was 1.1)
const ANIMATION_DURATION = 200; // milliseconds for hover animation
const FRAME_RATE = 20; // milliseconds per frame (50 frames per second)
const NUM_ANIMATION_STEPS = ANIMATION_DURATION / FRAME_RATE;

/**
 * Helper function for exponential easing (ease-out quintic for smooth deceleration).
 * Used for button hover animations.
 * @param {number} t - Normalized time (0 to 1).
 * @returns {number} Eased value.
 */
function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
}

/**
 * Creates and sets up an image button with hover animations.
 * It now *does not* automatically make the hitbox clickable.
 * You must call makeButton() separately.
 * @param {string} imageUrl - The URL of the image for the button.
 * @param {number} originalWidth - The original width of the image.
 * @param {number} originalHeight - The original height of the image.
 * @param {number} xPos - The x-position (top-left) of the button.
 * @param {number} yPos - The y-position (top-left) of the button.
 * @param {number} hitboxWidth - The width of the button's clickable area.
 * @param {number} hitboxHeight - The height of the button's clickable area.
 * @param {Function} onClickCallback - The function to call when the button is clicked.
 * @returns {object} An object containing the image shape and its hitbox rectangle.
 */
function createAnimatedButton(
    imageUrl,
    originalWidth,
    originalHeight,
    xPos,
    yPos,
    hitboxWidth,
    hitboxHeight,
    onClickCallback,
    buttonTextX,
    buttonTextY
) {
    // — image setup —
    const buttonImage = new ImageShape(imageUrl);
    buttonImage.originalWidth = originalWidth;
    buttonImage.originalHeight = originalHeight;
    buttonImage.originalX = xPos;
    buttonImage.originalY = yPos;
    buttonImage.setPosition(xPos, yPos);
    buttonImage.setSize(originalWidth, originalHeight);
    buttonImage.setLayer(3);

    // — compute text offset relative to the button —
    const textOffsetX = buttonTextX - xPos;
    const textOffsetY = buttonTextY - yPos;

    // — text setup —
    const buttonText = new Text("", "20pt Arial");
    buttonText.setColor("#ffffff");
    buttonText.setLayer(4);
    buttonText.originalFontSize = 20;
    // place at initial spot
    buttonText.setPosition(buttonTextX, buttonTextY);

    // — hitbox setup (centered under image) —
    const buttonHitbox = new Rectangle(hitboxWidth, hitboxHeight);
    buttonHitbox.setPosition(
        xPos + (originalWidth - hitboxWidth) / 2,
        yPos + (originalHeight - hitboxHeight) / 2
    );
    buttonHitbox.setColor("rgba(0,0,0,0)"); // Invisible hitbox
    buttonHitbox.setLayer(15); // Ensure hitbox is on a layer where it can receive events
    buttonHitbox.onClick = onClickCallback; // Assign the click callback

    // animation constants
    const FRAME_RATE = 1000 / 60; // Approximately 60 FPS
    const NUM_ANIMATION_STEPS = 10;
    const TARGET_SCALE_FACTOR = 1.1; // Button scales to 110% on hover
    let animationInterval; // To control the animation loop

    // — hover animation —
    buttonHitbox.onHover = () => {
        playButtonHover(); // Play a sound or perform other actions on hover
        clearInterval(animationInterval); // Clear any existing animation
        buttonImage.currentAnimationStep = 0; // Reset animation step

        animationInterval = setInterval(() => {
            const step = ++buttonImage.currentAnimationStep;
            let t = step / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1; // Clamp t to 1
            const easedT = easeOutQuint(t); // Apply easing function for smoother animation
            const scale = 1 + (TARGET_SCALE_FACTOR - 1) * easedT; // Calculate current scale

            // Calculate new image size & position based on scale
            const newW = originalWidth * scale;
            const newH = originalHeight * scale;
            const dx = (newW - originalWidth) / 2; // X-offset for centering
            const dy = (newH - originalHeight) / 2; // Y-offset for centering
            const newX = xPos - dx;
            const newY = yPos - dy;

            buttonImage.setSize(newW, newH); // Update image size
            buttonImage.setPosition(newX, newY); // Update image position

            // Mirror text offset and scale with the image
            if (buttonText.text) { // Only update text if it exists
                buttonText.font = `${buttonText.originalFontSize * scale}pt Arial`;
                buttonText.setPosition(
                    newX + textOffsetX * scale,
                    newY + textOffsetY * scale
                );
            }

            if (t === 1) clearInterval(animationInterval); // End animation when done
        }, FRAME_RATE);
    };

    // — unhover animation —
    buttonHitbox.onUnhover = () => {
        clearInterval(animationInterval); // Clear any existing animation
        buttonImage.currentAnimationStep = 0; // Reset animation step
        const startScale = buttonImage.width / originalWidth; // Current scale when unhovering starts

        animationInterval = setInterval(() => {
            const step = ++buttonImage.currentAnimationStep;
            let t = step / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1; // Clamp t to 1
            const easedT = easeOutQuint(t); // Apply easing function
            const scale = startScale - (startScale - 1) * easedT; // Calculate current scale back to 1

            const newW = originalWidth * scale;
            const newH = originalHeight * scale;
            const dx = (newW - originalWidth) / 2;
            const dy = (newH - originalHeight) / 2;
            const newX = xPos - dx;
            const newY = yPos - dy;

            buttonImage.setSize(newW, newH);
            buttonImage.setPosition(newX, newY);

            if (buttonText.text) {
                buttonText.font = `${buttonText.originalFontSize * scale}pt Arial`;
                buttonText.setPosition(
                    newX + textOffsetX * scale,
                    newY + textOffsetY * scale
                );
            }

            if (t === 1) {
                clearInterval(animationInterval);
                // Snap back exactly to original size and position to prevent rounding errors
                buttonImage.setSize(originalWidth, originalHeight);
                buttonImage.setPosition(xPos, yPos);
                if (buttonText.text) {
                    buttonText.font = `${buttonText.originalFontSize}pt Arial`;
                    buttonText.setPosition(xPos + textOffsetX, yPos + textOffsetY);
                }
            }
        }, FRAME_RATE);
    };

    // — return button object —
    const buttonObject = {
        image: buttonImage,
        hitbox: buttonHitbox,
        text: buttonText
    };

    /**
     * Sets the text displayed on the button.
     * @param {string} newText - The new text to display.
     */
    buttonObject.setText = function (newText) {
        this.text.setText(newText);
    };

    /**
     * Sets the opacity of the button's image, text, and optionally hitbox.
     * @param {number} opacityValue - The opacity level (0.0 to 1.0).
     */
    buttonObject.setOpacity = function (opacityValue) {
        this.image.setOpacity(opacityValue);
        // Assuming Text and Rectangle also have a setOpacity method.
        // If not, you might need to handle their visibility differently (e.g., this.text.setColor("rgba(255,255,255," + opacityValue + ")");)
        this.text.setOpacity(opacityValue);
        // You might not want the hitbox to fade, as it's typically invisible.
        // If it's ever visible and you want it to fade, uncomment or adjust:
        // this.hitbox.setOpacity(opacityValue);
    };

    /**
     * Adds all components of the button (image, text, hitbox) to the canvas.
     * Assumes `add` is a global function for adding objects to the rendering pipeline.
     */
    buttonObject.add = function () {
        add(this.image);
        add(this.text);
        add(this.hitbox);
    };

    /**
     * Removes all components of the button (image, text, hitbox) from the canvas.
     * Assumes `remove` is a global function for removing objects from the rendering pipeline.
     */
    buttonObject.remove = function () {
        remove(this.image);
        remove(this.text);
        remove(this.hitbox);
    };

    return buttonObject;
}
/**
 * Creates and sets up a clickable rectangle.
 * @param {number} xPos - The x-position (top-left) of the rectangle.
 * @param {number} yPos - The y-position (top-left) of the rectangle.
 * @param {number} width - The width of the rectangle.
 * @param {number} height - The height of the rectangle.
 * @param {string} color - The fill color of the rectangle.
 * @param {Function} onClickCallback - The function to call when the rectangle is clicked.
 * @returns {object} The created Rectangle shape.
 */
function createClickableRectangle(xPos, yPos, width, height, color, onClickCallback) {
    let rect = new Rectangle(width, height);
    rect.setPosition(xPos, yPos);
    rect.setColor(color);
    rect.setLayer(3); // Default layer for clickable boxes
    rect.onClick = onClickCallback;

    let animationInterval = null;
    const initialColor = color;
    const hoverColor = "rgba(100, 100, 100, 0.7)"; // Slightly lighter on hover

    rect.onHover = () => {
        if (animationInterval) clearInterval(animationInterval);
        rect.setColor(hoverColor);
    };

    rect.onUnhover = () => {
        if (animationInterval) clearInterval(animationInterval);
        rect.setColor(initialColor);
    };

    makeButton(rect, rect.onClick);
    return rect;
}


// Global array to store fetched games
let allGames = [];
let currentPage = 0;
const GAMES_PER_PAGE = 4; // Display 4 games per page

// Buttons array to keep track of current buttons for removal
let currentMenuObjects = [];

/**
 * Helper function to create an animated button and add its components to the canvas.
 */
function createAndAddButton(imagePath, x, y, width, height, onClick, text = "") {
    let buttonObj = createAnimatedButton(imagePath, width, height, x, y, width, height, onClick);
    add(buttonObj.image);
    // Only add text if it's not empty, consistent with the instruction to remove all texts
    if (text !== "") {
        add(buttonObj.text);
    }
    makeButton(buttonObj.hitbox, buttonObj.hitbox.onClick); // Use hitbox's stored onClick
    buttonObj.setText(text);
    currentMenuObjects.push(buttonObj.image, buttonObj.hitbox);
    if (text !== "") {
        currentMenuObjects.push(buttonObj.text);
    }
    return buttonObj;
}

/**
 * Clears all current objects from the canvas.
 */
function clearMenuCanvas() {
    for (let obj of currentMenuObjects) {
        remove(obj);
    }
    currentMenuObjects = [];
    removeAll(); // Also clears shapes array and clickableShapes array
}

// Player username
let username = localStorage.getItem("username") || '';


let playButton = createAnimatedButton(
    "https://codehs.com/uploads/5fee046b97d777d8c8021ad84cb6de20",
    1920 / 6, 1080 / 6, // Original width and height
    25, getHeight() / 2 - leftbuttonSpacing * 2.5, // Adjusted position
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions (slightly smaller than image)
    () => {
        console.log("Play button hit");
        playButtonHit(); // Call function to change menu state
         playButtonClick();
    }
);
// playButton.setText("Play"); // REMOVED TEXTf

let settingsButton = createAnimatedButton(
    "https://codehs.com/uploads/d1dabc10cb92069825cc3905b184c617",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 - leftbuttonSpacing * 1.5, // Position below Games
    1920 / 8, 1080 / 10,
    () => {
        console.log("Settings button hit");
        settingsButtonHit(); // Call new function for settings screen
         playButtonClick();
    }
);
// settingsButton.setText("Settings"); // REMOVED TEXT

let careerButton = createAnimatedButton(
    "https://codehs.com/uploads/eca6f39e9e72335f5f8118e7eaad8dc3",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 - leftbuttonSpacing * 0.5, // Position below Settings
    1920 / 8, 1080 / 10,
    () => {
        console.log("Career button hit");
        careerButtonHit(); // Call new function for career screen
         playButtonClick();
    }
);
// careerButton.setText("Career"); // REMOVED TEXT

let loadoutButton = createAnimatedButton(
    "https://codehs.com/uploads/8afd7d32fa74078c305bb952e4d7659b",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 0.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Loadout button hit");
        loadoutButtonHit(); // Call new function for loadout screen
         playButtonClick();
    }
);

let chatButton = createAnimatedButton(
    "https://codehs.com/uploads/755a17d7ba978d6bbe369953990c8e85",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 1.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Chat button hit");
        chatButtonHit(); // Call new function for loadout screen
         playButtonClick();
    }
);

let feedbackButton = createAnimatedButton(
    "https://codehs.com/uploads/7aadd2b35084d4d5d7dc63d16c1df045",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 2.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Chat button hit");
        feedbackButtonHit(); // Call new function for loadout screen
         playButtonClick();
    }
);

// Main Create Game Button (will be on the map selection screen)
let createGameBtn = createAnimatedButton(
    "https://codehs.com/uploads/66bc381a88433f3e4534a7e320539856", // Example image
    1920 / 6, 1080 / 6, // Original width and height
    getWidth() / 3 - 50, getHeight() - 250, // Position it below map options
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions
    () => {
        console.log("createGameBtn hit");
        createGameButtonHit();
         playButtonClick();
    }
);

let gamesButton = createAnimatedButton(
    "https://codehs.com/uploads/4786a0bebeb982d5d9692099047e8c49", // Provided games button image
    1920 / 6, 1080 / 6,
    getWidth() / 2 + 50, getHeight() - 250, // Position below Play
    1920 / 6 - 25, 1080 / 8,
    () => {
        console.log("Games button hit");
        gamesButtonHit();
         playButtonClick();
    }
);


let updateBoard = createAnimatedButton(
    "https://codehs.com/uploads/9323bdb40e74869eebd229ddd37ba098", // Provided games button image
    1080/3, 1440/3,
    getWidth() - (1080/3), getHeight()/2 - ((1440/3)/2), // Position below Play
    1080/3, 1440/3,
    () => {
        console.log("updateBoard button hit");
        updateBoardHit();
         playButtonClick();
    }
);


let playerCard = createAnimatedButton(
    "https://codehs.com/uploads/661908d8a660f740280ee10b350ae18b", // Provided games button image
    1080/3, 1440/3,
    getWidth()/2 - ((1080/3)/2), getHeight()/2 - ((1440/3)/2), // Position below Play
    1080/3, 1440/3,
    () => {
        console.log("updateBoard button hit");
        playerCardHit();
         playButtonClick();
    },
         getWidth()/2, getHeight()/2 + 170
);

 playerCard.setText(username); // REMOVED TEXT

let settingsMenu = new ImageShape("https://codehs.com/uploads/56483d9381657b285dc5dd85277963dd");
settingsMenu.setSize(1920, 1080);
settingsMenu.setPosition(getWidth()/2 - 1920/2, getHeight()/2 - 1080/2);

let loadoutMenu = new ImageShape("https://codehs.com/uploads/50e7492f5777ebcbaad604383f2b889f");
loadoutMenu.setSize(1920, 1080);
loadoutMenu.setPosition(getWidth()/2 - 1920/2, getHeight()/2 - 1080/2);

let careerMenu = new ImageShape("https://codehs.com/uploads/a3f192faf79ef45e5db517264dc50503");
careerMenu.setSize(1920, 1080);
careerMenu.setPosition(getWidth()/2 - 1920/2, getHeight()/2 - 1080/2);


let disclaimerText = new Text("⚠️ GAMES DO NOT AUTOCLEAR ⚠️", "30pt Arial");
disclaimerText.setColor("#ffffff");
disclaimerText.setPosition(getWidth()/2, getHeight()-100);



let escMenu = new ImageShape("https://codehs.com/uploads/ce8d9753693664ff70af6b371de3e7a0");
escMenu.setSize(1080 / 2, 1920 / 2);
escMenu.setPosition(getWidth() / 2 - (1080 / 4), getHeight() / 2 - (1920 / 4));

let inGameResumeBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 - 130*2,
    330, 100,
    () => {
        console.log("inGameResumeBtn hit"); // Corrected console log
        inGameResumeButtonHit();
        playButtonClick();
    }
);

function inGameResumeButtonHit() {
    clearMenuCanvas();
    settingsBox.style.display = "none";
    sensitivitySliderContainer.style.display = "none";

    // Revert canvas overlay styles
    canvas.style.display = 'none';
    canvas.style.position = '';
    canvas.style.top = '';
    canvas.style.left = '';
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.zIndex = '';

    // Hide and lock the cursor (if pointer lock is used for gameplay)
    document.body.style.cursor = 'none';

    // Set the global game unpause state - IMPORTANT: This should be a manual unpause
    setPauseState(false, false); // Explicitly set byDeath to false
}


let inGameSettingsBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 - 130,
    330, 100,
    () => {
        console.log("inGameSettingsBtn hit");
        inGameSettingsButtonHit();
        playButtonClick();
    }
);

function inGameSettingsButtonHit() {
    clearMenuCanvas();
    add(settingsMenu);
    // When going to settings, you are maintaining a manual pause state
    setPauseState(true, false); // Explicitly set byDeath to false
    
    settingsBox.style.display = 'block';
    sensitivitySliderContainer.style.display = "flex";
    addBackButton(inGameBack);
}

let inGameLoadoutBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 + 0,
    330, 100,
    () => {
        console.log("inGameLoadoutBtn hit"); // Corrected console log
        inGameLoadoutButtonHit();
        playButtonClick();
    }
);

function inGameLoadoutButtonHit() {
  if (window.localPlayer.isDead) {
    clearMenuCanvas(); // Clear current menu elements
    setPauseState(true);
    add(loadoutMenu);
    showLoadoutScreen(); // Show our DOM loadout overlay
    addBackButton(inGameBack); // Add a back button to return to the escape menu
  } else {
    Swal.fire({
      icon: 'warning',
      title: 'Hold up!',
      text: 'You have to be dead to change loadouts.',
      confirmButtonText: 'Got it',
      background: '#1e1e1e',
      color: '#ffffff',
      confirmButtonColor: '#ff4444',
    });
  }
}

let inGameLeaveBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 + 130,
    330, 100,
    () => {
        console.log("inGameLeaveBtn hit"); // Corrected console log
        inGameLeaveButtonHit();
        playButtonClick();
    }
);

function inGameLeaveButtonHit() {
     location.reload();
}

inGameResumeBtn.setOpacity(0);
inGameSettingsBtn.setOpacity(0);
inGameLoadoutBtn.setOpacity(0);
inGameLeaveBtn.setOpacity(0);

/**
 * Handles returning from the settings menu back to the main escape menu.
 */
function inGameBack() {
    clearMenuCanvas();
    settingsBox.style.display = "none";
    sensitivitySliderContainer.style.display = "none";
    // Returning to main menu is still a manual pause, don't re-trigger auto-unpause logic
    setPauseState(true, false);
    hideLoadoutScreen();
    
    add(escMenu);
    add(inGameResumeBtn.image);
    makeButton(inGameResumeBtn.hitbox, inGameResumeBtn.hitbox.onClick);

    add(inGameSettingsBtn.image);
    makeButton(inGameSettingsBtn.hitbox, inGameSettingsBtn.hitbox.onClick);

    add(inGameLoadoutBtn.image);
    makeButton(inGameLoadoutBtn.hitbox, inGameLoadoutBtn.hitbox.onClick);

        add(inGameLeaveBtn.image);
        makeButton(inGameLeaveBtn.hitbox, inGameLeaveBtn.hitbox.onClick);
}

/**
 * Toggles the visibility of the pause menu and manages game pause state.
 * @param {boolean} shouldPause - True to pause and show menu, false to unpause and hide menu.
 */
function togglePauseMenuUI(shouldPause) {
    if (shouldPause) {
        add(escMenu);

        add(inGameResumeBtn.image);
        makeButton(inGameResumeBtn.hitbox, inGameResumeBtn.hitbox.onClick);
            
        add(inGameSettingsBtn.image);
        makeButton(inGameSettingsBtn.hitbox, inGameSettingsBtn.hitbox.onClick);

        add(inGameLoadoutBtn.image);
        makeButton(inGameLoadoutBtn.hitbox, inGameLoadoutBtn.hitbox.onClick);

        add(inGameLeaveBtn.image);
        makeButton(inGameLeaveBtn.hitbox, inGameLeaveBtn.hitbox.onClick);
            
        canvas.style.display = 'block';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '20';

        document.body.style.cursor = 'auto';

        // When toggling the UI ON, it's always a manual pause.
        setPauseState(true, false); // Explicitly set byDeath to false
    } else {
        clearMenuCanvas();
        settingsBox.style.display = "none";
        sensitivitySliderContainer.style.display = "none";

        canvas.style.display = 'none';
        canvas.style.position = '';
        canvas.style.top = '';
        canvas.style.left = '';
        canvas.style.width = '';
        canvas.style.height = '';
        canvas.style.zIndex = '';

        document.body.style.cursor = 'none';

        // When toggling the UI OFF, it's always a manual unpause.
        setPauseState(false, false); // Explicitly set byDeath to false
    }
}

// Global variable to track if the game is "in-game" and therefore eligible for pausing.
let checkInGame = false;

// Expose togglePauseMenuUI globally if it needs to be called from input.js or other modules
window.togglePauseMenuUI = togglePauseMenuUI; // This makes it accessible from input.js

// Listen for the 'P' key press to toggle the pause menu
window.addEventListener("keydown", e => {

 //   console.log("  currentKeybinds.togglePause:", currentKeybinds.togglePause);
 //   console.log("  inputState.isPaused:", inputState.isPaused);
 //   console.log("  document.activeElement:", document.activeElement);
    // Check if the pressed key matches the currently configured togglePause keybind
    // and if the game is active and not chat-focused (assuming checkInGame is available)
    if (checkInGame && e.code === currentKeybinds.togglePause) {
             console.log("Keydown in other file:", e.code, e.key);

        // Allow toggling menu even if dead — just don't resume the game.
        if (!inputState.isPaused || inputState.wasPausedByDeath) {
            if (typeof window.togglePauseMenuUI === 'function') {
                window.togglePauseMenuUI(true); // Force show pause menu
            } else {
                console.warn("window.togglePauseMenuUI is not defined. Pause menu might not show.");
                // Fallback: Manually toggle pause state if UI function is missing
                inputState.isPaused = true;
                inputState.wasPausedByDeath = false; // Assuming manual pause isn't by death
            }
        } else {
            if (typeof window.togglePauseMenuUI === 'function') {
                window.togglePauseMenuUI(false); // Hide menu
            } else {
                console.warn("window.togglePauseMenuUI is not defined. Pause menu might not hide.");
                // Fallback: Manually toggle pause state if UI function is missing
                inputState.isPaused = false;
                inputState.wasPausedByDeath = false;
            }
        }
        e.preventDefault();
    }
});



function playerCardHit() {
    // 1) Inject popup‑wide styles (gradient & icon color)
    const style = document.createElement('style');
    style.textContent = `
      /* popup gradient & text */
      .swal2-popup-gradient {
        background: linear-gradient(to right, #C58DE3 0%, #8459ff 100%);
        color: #ffffff;
      }
      /* icon color (info icon in this case) */
      .swal2-icon.swal2-info {
        border-color: #ffffff;              /* outline */
        color: #ffffff;                     /* the “i” itself */
      }
      /* if you ever use other icons, e.g. .swal2-icon.swal2-success, you can style them here too */
    `;
    document.head.appendChild(style);

    // 2) Fire the alert, specifying confirmButtonColor
    Swal.fire({
        title: localStorage.getItem("username"),
        text: 'ur trash',
        icon: 'info',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#b7adff',      // <-- button background
        customClass: {
            popup: 'swal2-popup-gradient',  // your gradient class
        }
    }).then((result) => {
        if (result.isConfirmed) {
            console.log("User acknowledged board update.");
        }
    });
}


function updateBoardHit() {
    // 1) Inject popup‑wide styles (gradient & icon color)
    const style = document.createElement('style');
    style.textContent = `
      /* popup gradient & text */
      .swal2-popup-gradient {
        background: linear-gradient(to right, #C58DE3 0%, #8459ff 100%);
        color: #ffffff;
      }
      /* icon color (info icon in this case) */
      .swal2-icon.swal2-info {
        border-color: #ffffff;              /* outline */
        color: #ffffff;                     /* the “i” itself */
      }
      /* if you ever use other icons, e.g. .swal2-icon.swal2-success, you can style them here too */
    `;
    document.head.appendChild(style);

    // 2) Fire the alert, specifying confirmButtonColor
    Swal.fire({
        title: 'Void.FFA v1.00',
        text: 'The release of Void.FFA.',
        icon: 'info',
        confirmButtonText: 'wowzery!',
        confirmButtonColor: '#b7adff',      // <-- button background
        customClass: {
            popup: 'swal2-popup-gradient',  // your gradient class
        }
    }).then((result) => {
        if (result.isConfirmed) {
            console.log("User acknowledged board update.");
        }
    });
}


/**
 * Initializes the main menu by adding all primary menu elements to the canvas.
 * Now explicitly calls makeButton for initial clickable elements.
 */
function menu() {
     if(dontyetpls == 0){  menuSong.play(); }
     dontyetpls = 1;
     
    clearMenuCanvas(); // Clear anything previously on canvas
    // add(background); // REMOVED BACKGROUND
    sensitivitySliderContainer.style.display = "none"; // Or "block", depending on your CSS layout
add(disclaimerText);

   settingsBox.style.display = "none"; // Or "flex", depending on your CSS layout
hud.style.display = "none";
menuBG.style.display = "flex";
 loadMenu.style.display = "none";
     
    add(logo);
     
     add(updateBoard.image);
     makeButton(updateBoard.hitbox, updateBoard.hitbox.onClick);
    // Add main menu buttons
    add(playButton.image);
    // add(playButton.text); // REMOVED TEXT
    makeButton(playButton.hitbox, playButton.hitbox.onClick);

    add(settingsButton.image);
    // add(settingsButton.text); // REMOVED TEXT
    makeButton(settingsButton.hitbox, settingsButton.hitbox.onClick);

    add(careerButton.image);
    // add(careerButton.text); // REMOVED TEXT
    makeButton(careerButton.hitbox, careerButton.hitbox.onClick);

    add(loadoutButton.image);
    // add(loadoutButton.text); // REMOVED TEXT
    makeButton(loadoutButton.hitbox, loadoutButton.hitbox.onClick);

    add(chatButton.image);
    makeButton(chatButton.hitbox, chatButton.hitbox.onClick);

    add(feedbackButton.image);
    makeButton(feedbackButton.hitbox, feedbackButton.hitbox.onClick);
     
    currentMenuObjects.push(playButton.image, playButton.hitbox, gamesButton.image, gamesButton.hitbox, settingsButton.image, settingsButton.hitbox, careerButton.image, careerButton.hitbox, loadoutButton.image, loadoutButton.hitbox, chatButton.hitbox, chatButton.hitbox.onClick,
                           feedbackButton.hitbox, feedbackButton.hitbox.onClick);
}

// Helper to start game after menu hides
function showMenuOverlay() {
  const menuOverlay = document.getElementById("menu-overlay");
  if (menuOverlay) {
    menuOverlay.style.display = "flex";
    menuOverlay.classList.remove("hidden");
  }
  if (canvas) {
    canvas.style.display = "block";
  }
  const gameWrapper = document.getElementById("game-container");
  if (gameWrapper) {
    gameWrapper.style.display = "none";
  }
  const crosshair = document.getElementById("crosshair");
  if (crosshair) crosshair.style.display = "none";
}

async function initAndStartGame(username, mapName, gameId = null) {
     clearMenuCanvas();
     checkInGame = true; 
     dontyetpls = 0;
     hud.style.display = "block";
  // Read your UI flags up front
  const detailsEnabled = localStorage.getItem("detailsEnabled") === true;
  const ffaEnabled     = true; // ← or read from your HTML toggle if you have one

  // Hide the canvas‑menu overlay
  const menuOverlay = document.getElementById("menu-overlay");
  if (menuOverlay) menuOverlay.classList.add("hidden");
  if (canvas)      canvas.style.display = "none";

  // Ensure game container exists
  const gameWrapper = document.getElementById("game-container");
  if (!gameWrapper) {
    console.error("game-container element not found! Cannot start game.");
    Swal.fire('Error', 'Game container not found, cannot start game.', 'error');
    return menu();
  }

  // Bring up the in‑game UI
  menuSong.pause();
  gameWrapper.style.display = "block";
  createGameUI(gameWrapper);
  initBulletHoles(gameWrapper);

  // 2) Only once the network is live do we actually start the game loop
  startGame(username, mapName, detailsEnabled, ffaEnabled, gameId);
     menuBG.style.display = "none";
  console.log(
    `Game started for map: ${mapName}, Username: ${username}, ` +
    `Details: ${detailsEnabled}, FFA: ${ffaEnabled}, Game ID: ${gameId}`
  );
}

/**
 * Function called when the "Play" button (canvas-drawn) is clicked.
 * Clears the current menu and displays the canvas-based map selection options.
 */
function playButtonHit() {
    clearMenuCanvas(); // Clear all current canvas objects

    add(logo);

     add(playerCard.image);
     add(playerCard.text);
    makeButton(playerCard.hitbox, playerCard.hitbox.onClick);

    add(gamesButton.image);
    // add(gamesButton.text); // REMOVED TEXT
    makeButton(gamesButton.hitbox, gamesButton.hitbox.onClick);
    // Add the "Create Game" button
    add(createGameBtn.image);
    add(createGameBtn.text);
    makeButton(createGameBtn.hitbox, createGameBtn.hitbox.onClick);
    currentMenuObjects.push(createGameBtn.image, createGameBtn.text, createGameBtn.hitbox);

    addBackButton(menu); // Add back button to this screen
}


let chatListener = null;

function createMenuChatElements() {
    // container
    const box = document.createElement("div");
    box.id = "chat-box";
    Object.assign(box.style, {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "80vw",
        maxWidth: "400px",
        background: "rgba(0,0,0,0.6)",
        border: "1px solid #444",
        borderRadius: "6px",
        zIndex: "9999",
        display: "flex",
        flexDirection: "column",
    });

    // messages
    const messages = document.createElement("div");
    messages.id = "chat-messages";
    Object.assign(messages.style, {
        flex: "1 1 auto",
        padding: "8px",
        overflowY: "auto",
        color: "#fff",
        fontSize: "0.85rem",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
    });

    // input
    const input = document.createElement("input");
    input.id = "chat-input";
    input.placeholder = "Type a message…";
    Object.assign(input.style, {
        flex: "0 0 auto",
        border: "none",
        padding: "6px",
        fontSize: "0.9rem",
        outline: "none",
        background: "rgba(20,20,20,0.8)",
        color: "#fff",
    });

    box.append(messages, input);
    document.body.append(box);
}

function initChatUI() {
    const input = document.getElementById("chat-input");
    const messagesBox = document.getElementById("chat-messages");

    // Add event listener for the 'Enter' key
    input.addEventListener("keyup", function(event) {
        // Check if the key pressed is 'Enter' (key code 13 or key property 'Enter')
        if (event.key === "Enter") {
            const text = input.value.trim();
            if (text) {
                const username = localStorage.getItem("username") || "Guest";
                sendChatMessage(username, text);
                input.value = ""; // Clear the input field after sending
            }
        }
    });

    // You can also add other UI logic here, like auto-scrolling
    // to the bottom of the message box when a new message arrives.
    // This is already being handled by `addChatMessage` in some implementations.
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

function destroyMenuChatElements() {
    const box = document.getElementById("chat-box");
    if (box) box.remove();
    // detach listener
    // This now uses menuChatRef, which is globally defined
    if (menuChatRef && chatListener) {
        menuChatRef.off("child_added", chatListener);
        chatListener = null;
    }
}

function initMenuChat() {
    // 2) The chatRef is already initialized as a global variable
    dbRefs.chatRef = menuChatRef;

    // 3) create DOM
    createMenuChatElements();

    // 4) wire up your helper code
    initChatUI(); // This is the function that now sets up the 'Enter' key listener
    
    // The onChildAdded listener is attached directly to the global menuChatRef
    chatListener = menuChatRef.on('child_added', snapshot => {
        const { username, text } = snapshot.val();
        addChatMessage(username, text, snapshot.key);
        // Scroll to the bottom when a new message is added
        const messagesBox = document.getElementById("chat-messages");
        if (messagesBox) {
            messagesBox.scrollTop = messagesBox.scrollHeight;
        }
    });
}

export function sendChatMessage(username, text) {
    // Ensure the global menuChatRef is available before pushing
    if (!menuChatRef) {
        return console.warn("Chat not initialized yet");
    }
    menuChatRef.push({ username, text, timestamp: Date.now() })
        .catch(err => console.error("Failed to send chat:", err));
}

export function chatButtonHit() {
    clearMenuCanvas();
    add(logo);
    addBackButton(() => {
        destroyMenuChatElements();
        menu();
    });

    initMenuChat();
}

function feedbackButtonHit() {
    clearMenuCanvas(); // Clear all current canvas objects

    add(logo);

    addBackButton(menu); // Add back button to this screen
}



/**
 * Handles the "Create Game" button click.
 * Uses SweetAlert2 for input and pushes game data to Firebase.
 */
export async function createGameButtonHit() {
    username = localStorage.getItem("username");

    // Assign the player's current version when they attempt to create a game
    localStorage.setItem("playerVersion", CLIENT_GAME_VERSION);
    await assignPlayerVersion(username, CLIENT_GAME_VERSION);

    if (!username || !username.trim()) {
        return Swal.fire('Error', 'Please set your username first.', 'error');
    }

    if (CLIENT_GAME_VERSION !== requiredGameVersion) {
        return Swal.fire(
            'Update Required',
            `Your game version (${CLIENT_GAME_VERSION}) does not match the required version (${requiredGameVersion}). Please refresh your tab to create games.`,
            'error'
        );
    }

    const { value: formValues } = await Swal.fire({
        title: 'Create New Game',
        html: `
            <input id="swal-input1" class="swal2-input" placeholder="Game Name" value="${username}'s Game">
            <select id="swal-input2" class="swal2-select">
                <option value="">Select Map</option>
                <option value="DiddyDunes">DiddyDunes</option>
                <option value="SigmaCity">SigmaCity</option>
                <option value="CrocodilosConstruction">CrocodilosConstruction</option>
            </select>
            <select id="swal-input3" class="swal2-select">
                <option value="FFA">FFA</option>
            </select>
        `,
        focusConfirm: false,
        preConfirm: () => {
            const gameName = document.getElementById('swal-input1').value;
            const map = document.getElementById('swal-input2').value;
            const mode = document.getElementById('swal-input3').value;
            if (!gameName || !map || !mode) {
                Swal.showValidationMessage(`Please fill all fields`);
                return false;
            }
            return { gameName, map, gamemode: mode };
        }
    });

    if (!formValues) {
        return;
    }

    try {
        // 🔍 Check if a game with the same name already exists
        const snapshot = await gamesRef.orderByChild("gameName").equalTo(formValues.gameName).once("value");
        if (snapshot.exists()) {
            return Swal.fire('Error', `A game named "${formValues.gameName}" already exists. Please choose a different name.`, 'error');
        }

        const gameData = {
            gameName: formValues.gameName,
            map: formValues.map,
            gamemode: formValues.gamemode,
            host: username,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            status: "waiting",
            gameVersion: CLIENT_GAME_VERSION
        };

        const newGameRef = gamesRef.push();
          await newGameRef.set(gameData);
        const gameId = newGameRef.key;
        let ffaEnabled = true;

        const slotResult = await claimGameSlot(username, formValues.map, ffaEnabled);
        await gamesRef.child(gameId).child('status').set("starting");

        if (!slotResult) {
            await newGameRef.remove();
            Swal.fire('Error', 'No free slots available or version mismatch. Game discarded.', 'error');
            return;
        }

        await gamesRef.child(gameId).child('slot').set(slotResult.slotName);

        Swal.fire({
            title: 'Game Created!',
            html: `Game: <b>${formValues.gameName}</b><br>Map: <b>${formValues.map}</b><br>ID: <b>${gameId}</b>`,
            icon: 'success',
            confirmButtonText: 'Join Game'
        }).then(res => {
            if (res.isConfirmed) {
                // nice
            } else {
                // nice
            }
        });

    } catch (error) {
        console.error("Error creating game:", error);
        Swal.fire('Error', 'Could not create game: ' + error.message, 'error');
    }
}


export async function gamesButtonHit() {
    clearMenuCanvas();
    add(logo);
    let loadingText = new Text("Loading games...", "30pt Arial");
    loadingText.setColor("#ffffff");
    loadingText.setPosition(getWidth() / 2, getHeight() / 2);
    add(loadingText);
    currentMenuObjects.push(loadingText);

    username = localStorage.getItem("username");
    // Assign player's current version when they attempt to browse games
    localStorage.setItem("playerVersion", CLIENT_GAME_VERSION);
    if (username) {
        await assignPlayerVersion(username, CLIENT_GAME_VERSION);
    }

    try {
        const snapshot = await gamesRef.once('value');
        const gamesObj = snapshot.val() || {};

        const activeSlots = Object.entries(gamesObj)
            .filter(([id, game]) => {
                // Filter out games that don't match the client's version
                return (game.status === "waiting" || game.status === "starting") &&
                    game.gameVersion === CLIENT_GAME_VERSION; // Only show games that match player's version
            })
            .map(([id, game]) => ({
                id,
                gameName: game.gameName,
                host: game.host,
                map: game.map,
                createdAt: game.createdAt,
                slot: game.slot,
                gameVersion: game.gameVersion // Include gameVersion in the slot info
            }))
            .sort((a, b) => b.createdAt - a.createdAt);

        remove(loadingText);

        if (activeSlots.length === 0) {
            let none = new Text("No active games available for your version. Create one!", "30pt Arial");
            none.setColor("#ffffff");
            none.setPosition(getWidth() / 2, getHeight() / 2);
            add(none);
            currentMenuObjects.push(none);
            addBackButton(playButtonHit);
            return;
        }

        const GAMES_PER_PAGE = 4;
        const startIndex = currentPage * GAMES_PER_PAGE;
        const pageSlots = activeSlots.slice(startIndex, startIndex + GAMES_PER_PAGE);

        let yStart = 200;
        const entryHeight = 150;

        for (let i = 0; i < pageSlots.length; i++) {
            const slotInfo = pageSlots[i];
            const gameId = slotInfo.id;
            const mapName = slotInfo.map;
            const y = yStart + i * entryHeight;

            // Background hitbox
            let gameBg = createClickableRectangle(
                getWidth() * 0.1,
                y - 50,
                getWidth() * 0.8,
                100,
                "rgba(50,50,50,0.7)",
                async () => { // Made the callback async
                    console.log(`Joining game ${slotInfo.gameName} on map ${mapName}`);
                    // Version check before joining a game
                    const playerVersion = localStorage.getItem("playerVersion"); // The client's version
                    if (playerVersion !== slotInfo.gameVersion) {
                        Swal.fire('Version Mismatch', `This game requires version ${slotInfo.gameVersion}, but your game is version ${playerVersion || 'N/A'}. Please update to join.`, 'error');
                        return; // Prevent joining the game
                    }

                    // If versions match, proceed to join
                    setActiveGameId(gameId);
                    initAndStartGame(username, mapName, gameId);
                }
            );
            add(gameBg);
            currentMenuObjects.push(gameBg);

            // Game name
            let titleText = new Text(`${slotInfo.gameName}`, "25pt Arial");
            titleText.setColor("#55eeff");
            titleText.setPosition(getWidth() * 0.5, y);
            add(titleText);
            currentMenuObjects.push(titleText);

            // Map details with version info
            let detailsText = new Text(`Map: ${slotInfo.map} (Ver: ${slotInfo.gameVersion})`, "15pt Arial");
            detailsText.setColor("#999999");
            detailsText.setPosition(getWidth() * 0.5, y + 30);
            add(detailsText);
            currentMenuObjects.push(detailsText);
        }

        const maxPages = Math.ceil(activeSlots.length / GAMES_PER_PAGE);
        const paginationY = getHeight() - 100;

        if (currentPage > 0) {
            let leftArrow = createAndAddButton(
                "https://codehs.com/uploads/4bcd4b492845bb3587c71c211d29903d",
                getWidth() / 2 - 150, paginationY,
                70, 70,
                () => {
                    currentPage--;
                    gamesButtonHit();
                },
                ""
            );
            leftArrow.image.setLayer(4);
            leftArrow.hitbox.setLayer(16);
            currentMenuObjects.push(leftArrow.image, leftArrow.hitbox);
        }

        if (currentPage < maxPages - 1) {
            let rightArrow = createAndAddButton(
                "https://codehs.com/uploads/1bb4c45ae81aae1da5cebb8bb0713748",
                getWidth() / 2 + 80, paginationY,
                70, 70,
                () => {
                    currentPage++;
                    gamesButtonHit();
                },
                ""
            );
            rightArrow.image.setLayer(4);
            rightArrow.hitbox.setLayer(16);
            currentMenuObjects.push(rightArrow.image, rightArrow.hitbox);
        }

        if (maxPages > 0) {
            let pageText = new Text(`Page ${currentPage + 1} of ${maxPages}`, "20pt Arial");
            pageText.setColor("#ffffff");
            pageText.setPosition(getWidth() / 2, paginationY + 15);
            add(pageText);
            currentMenuObjects.push(pageText);
        }

        addBackButton(playButtonHit);

    } catch (error) {
        console.error("Error fetching slots:", error);
        remove(loadingText);
        let errorText = new Text("Error loading games: " + error.message, "20pt Arial");
        errorText.setColor("#ff0000");
        errorText.setPosition(getWidth() / 2, getHeight() / 2);
        add(errorText);
        currentMenuObjects.push(errorText);
        addBackButton(playButtonHit);
    }
}
/**
 * Adds a "Back to Menu" button to the current screen.
 */
function addBackButton(destination, func) {
    let backButton = createAndAddButton(
        "https://codehs.com/uploads/5c5306facf6c0ecf2e1e4b4d12a1e17d", // Left arrow image
        1080/16, 1080/16, // Top-left corner
        1920/16, 1080/16, // Size for back button
        () => {
            currentPage = 0; // Reset page when going back to main menu
            destination(); // Go back to main menu
            func();
        },
    );
    // Adjust text position relative to its button for 'Back'
    backButton.image.setLayer(4); // Ensure back button is visible
    backButton.hitbox.setLayer(16);
    currentMenuObjects.push(backButton.image, backButton.text, backButton.hitbox);
}

/**
 * Handles the "Settings" button click.
 * Clears the current menu and displays a placeholder settings screen.
 */
function settingsButtonHit() {
    clearMenuCanvas();
     add(settingsMenu);
    // Get the HTML elements for the sensitivity slider and settings box


    // Show these elements
    if (sensitivitySliderContainer) {
        sensitivitySliderContainer.style.display = "flex"; // Or "block", depending on your CSS layout
    }
    if (settingsBox) {
        settingsBox.style.display = "block"; // Or "flex", depending on your CSS layout
    }

    addBackButton(menu); // Keep the back button to return to the main menu
}

/**
 * Handles the "Career" button click.
 * Clears the current menu and displays a placeholder career screen.
 */
function careerButtonHit() {
  clearMenuCanvas();
     add(careerMenu);
  addBackButton(menu);

  const username = localStorage.getItem('username') || 'Guest';
  const lineHeight = 60;
  const canvasWidth = getWidth();

  // Create a single off-screen canvas context for measuring text
  const measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = "20pt Arial";

  function createStatText(content, y) {
    const text = new Text(content, "40pt Arial");
    text.setColor("#ffffff");
    text.setLayer(4);
    text.originalFontSize = 20;

    // Measure width and center
    const textWidth = measureCtx.measureText(content).width;
    const centerX = canvasWidth / 2;
    text.setPosition(centerX, y);

    return text;
  }

  function displayStats(userData) {
    const stats = userData.stats || {};
    const wins = stats.wins || 0;
    const kills = stats.kills || 0;
    const deaths = stats.deaths || 0;
    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : 'N/A';
    const losses = stats.losses || 0; // Ensure losses are pulled from stats object

    // Calculate Win Percentage
    let winPercentage = 'N/A';
    const totalGames = wins + losses;
    if (totalGames > 0) {
      winPercentage = ((wins / totalGames) * 100).toFixed(2) + '%';
    }

    const lines = [
      `Career Stats for ${username}`,
      `Wins: ${wins}`,
      `Losses: ${losses}`,
      `Win %: ${winPercentage}`, // Added Win Percentage
      `Kills: ${kills}`,
      `Deaths: ${deaths}`,
      `K/D Ratio: ${kd}`
    ];

    // Start drawing at y = 250
    let y = 350;
    for (let i = 0; i < lines.length; i++) {
      const lineText = createStatText(lines[i], y + i * lineHeight);
      add(lineText);
    }
  }

  usersRef.child(username).once('value')
    .then(snap => {
      if (snap.exists()) {
        displayStats(snap.val());
      } else {
        return usersRef
          .orderByChild('username')
          .equalTo(username)
          .once('value')
          .then(qsnap => {
            let userData = null;
            qsnap.forEach(child => {
              userData = child.val();
            });
            if (!userData) throw new Error("User not found in database.");
            displayStats(userData);
          });
      }
    })
    .catch(err => {
      console.error("Error loading career stats:", err);
      const errorText = createStatText("Unable to load stats.", 150);
      add(errorText);
    });
}
/**
 * Handles the "Loadout" button click.
 * Clears the current menu and displays a placeholder loadout screen.
 */
function loadoutButtonHit() {
  // first clear out any canvas‑drawn menu items
  clearMenuCanvas();
add(loadoutMenu);
  // show our DOM loadout overlay
  showLoadoutScreen();

  // add a “Back” hookup to return to the canvas menu
  // (you already have addBackButton() logic that maybe wants to go back—
  //  just hook it to hide the loadout screen)
  addBackButton(menu, hideLoadoutScreen);
}


    function setSensitivity(newVal) {
        const v = Math.min(parseFloat(sensitivityRange.max), Math.max(parseFloat(sensitivityRange.min), newVal)).toFixed(2);
        sensitivityRange.value = v;
        sensitivityInput.value = v;
        localStorage.setItem("sensitivity", v);
        document.dispatchEvent(new CustomEvent("updateSensitivity", { detail: parseFloat(v) }));
    }

    const savedSens = localStorage.getItem("sensitivity") || "5.00";

        setSensitivity(parseFloat(savedSens));
        sensitivityRange.addEventListener('input', () => {
             console.log("test")
            setSensitivity(sensitivityRange.value);
        });
        sensitivityInput.addEventListener('change', () => {
             console.log("test")
            setSensitivity(parseFloat(sensitivityInput.value));
        });


/**
 * Initializes the main menu UI, handling username entry, map selection,
 * sensitivity settings, and the details toggle. This function primarily
 * interacts with HTML elements for the menu.
 */
export function initMenuUI() {
    const menuOverlay = document.getElementById("menu-overlay");
    const usernamePrompt = document.getElementById("username-prompt");
    const mapSelect = document.getElementById("map-menu");
    const controlsMenu = document.getElementById("menu-controls-menu"); // Corrected ID


    // These elements are assumed to be part of the HTML structure,
    // distinct from the canvas-drawn buttons.
    const htmlPlayButton = document.getElementById("play-button");
    const htmlSettingsButton = document.getElementById("settings-button");
    const htmlCareerButton = document.getElementById("career-button");

    const saveUsernameBtn = document.getElementById("save-username-btn");
    const usernameInput = document.getElementById("username-input");

    const toggleDetailsBtn = document.getElementById("toggle-details-btn");

    const mapButtons = document.querySelectorAll(".map-btn"); // HTML map selection buttons

    username = localStorage.getItem("username") || ""; // Ensure username is updated for HTML side
    let currentDetailsEnabled = localStorage.getItem("detailsEnabled") === "false" ? false : true;

    /**
     * Helper function to show a specific panel and hide others.
     * @param {HTMLElement|null} panelToShow - The panel element to display, or null to hide all.
     */
    function showPanel(panelToShow) {
        // Hide all potential panels first
        [usernamePrompt, mapSelect, controlsMenu].forEach(panel => {
            if (panel) panel.classList.add("hidden");
        });
        // Show the desired panel
        if (panelToShow) {
            panelToShow.classList.remove("hidden");
            // Ensure display is set to flex for panels that use it for centering
            panelToShow.style.display = 'flex';
        }
    }

    // --- Initial Menu State Setup ---
    function initializeMenuDisplay() {
        // If username exists, hide prompt and show canvas menu
        if (username && username.trim().length > 0) {
            showPanel(null); // Hide all HTML panels
            menu(); // Show canvas-drawn main menu
            document.getElementById("game-logo").classList.add("hidden"); // Hide the HTML game logo
            const menuOverlayElement = document.getElementById('menu-overlay');
            menuOverlayElement.style.display = 'none';

            canvas.style.display = 'block'; // Ensure canvas is visible
        } else {
            // If no username, show the prompt
            showPanel(usernamePrompt);
            // Hide the canvas, as the username prompt is an HTML overlay
            canvas.style.display = 'none';
            // Show the HTML game logo above the username prompt
            document.getElementById("game-logo").classList.remove("hidden");
        }
    }

    // --- Event Listeners for Main Menu Buttons (HTML-based) ---
    // These HTML buttons are distinct from the canvas buttons.
    if (htmlPlayButton) {
        htmlPlayButton.addEventListener("click", () => {
            console.log("HTML Play button clicked (showing map selection)");
            showPanel(mapSelect);
        });
    }

    if (htmlSettingsButton) {
        htmlSettingsButton.addEventListener("click", () => {
            showPanel(controlsMenu);
        });
    }

    if (htmlCareerButton) {
        htmlCareerButton.addEventListener("click", () => {
            console.log("HTML Career button clicked!");
        });
    }

    // --- Username Prompt Logic ---
    if (usernameInput && username) {
        usernameInput.value = username;
    }

if (saveUsernameBtn) {
  saveUsernameBtn.addEventListener("click", async () => {
    const raw = usernameInput.value.trim();
    const val = raw; // already trimmed
    const alphaNumRegex = /^[A-Za-z0-9_]+$/;

    // 1) Basic format validation
    if (!alphaNumRegex.test(val)) {
      return Swal.fire(
        'Invalid Username',
        'Usernames may only contain letters (A–Z), numbers (0–9), or underscores (_), with no spaces or other symbols.',
        'error'
      );
    }

    // Normalize to lowercase for the DB key so that "Jar" and "jar" collide
    const key = val.toLowerCase();

    // 2) Uniqueness check by directly looking at usersRef/<key>
    try {
      const userNode = usersRef.child(key);
      const snap     = await userNode.once('value');

      if (snap.exists()) {
        return Swal.fire(
          'Name Taken',
          `“${val}” is already in use. Please choose another.`,
          'warning'
        );
      }
    } catch (err) {
      console.error("Error checking existing usernames:", err);
      return Swal.fire(
        'Error',
        'Could not verify username uniqueness. Please try again in a moment.',
        'error'
      );
    }

    // 3) Save locally
    localStorage.setItem("username", val);
    username = val;
    playerCard.setText(username);

    // 4) Write to menu DB under the username key
    //    this will create /users/<lowercase-username> instead of a push-id
    usersRef
      .child(key)
      .set({
        username: val,
        savedAt:  firebase.database.ServerValue.TIMESTAMP
      })
      .catch(err => {
        console.error("Error saving username to DB:", err);
        // you could show another Swal here if you want
      });

    // 5) Hide prompt and show game
    showPanel(null);
    canvas.style.display = 'block';
    menu();
    document.getElementById("game-logo").classList.add("hidden");
    const menuOverlayElement = document.getElementById('menu-overlay');
    if (menuOverlayElement) {
      menuOverlayElement.style.display = 'none';
    }
  });
}


    // --- Details Toggle Logic ---
    if (toggleDetailsBtn) {
        toggleDetailsBtn.textContent = currentDetailsEnabled ? "Details: On" : "Details: Off";

        toggleDetailsBtn.addEventListener("click", () => {
            currentDetailsEnabled = !currentDetailsEnabled;
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            toggleDetailsBtn.textContent = currentDetailsEnabled
                ? "Details: On"
                : "Details: Off";

            // Directly call toggleSceneDetails from game.js
            toggleSceneDetails(currentDetailsEnabled);
        });
    }

    // --- Map Selection Logic (for HTML buttons) ---
    mapButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            username = localStorage.getItem("username");
            if (!username) {
                showPanel(usernamePrompt); // Prompt for username if not set
                Swal.fire('Warning', 'Please enter your username before starting a game!', 'warning');
                return;
            }

            const mapName = btn.dataset.map;
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            console.log(`Player clicked HTML map button for map: ${mapName}, Username: ${username}, Details Enabled: ${currentDetailsEnabled}`);

            // Hide the menu overlay to reveal the game
            if (menuOverlay) {
                menuOverlay.classList.add("hidden");
            }
            // Hide the canvas if the HTML menu is taking over
            if (canvas) {
                canvas.style.display = 'none';
            }

            // Initialize game UI and start the game
            const gameWrapper = document.getElementById('game-container');
            if (gameWrapper) {
                let ffaEnabled = true;
                menuSong.pause();
                gameWrapper.style.display = 'block'; // Or 'flex', depending on its CSS
                createGameUI(gameWrapper); // Create game UI elements
               // initNetwork(username, mapName); // Initialize network for multiplayer
              //  startGame(username, mapName, localStorage.getItem("detailsEnabled") === "true", ffaEnabled); // Start the game

                console.log(`Game UI and game initialized directly on index.html for map: ${mapName}.`);
            } else {
                console.error("game-container element not found in index.html! Make sure your game elements are present.");
            }
        });
    });

    initializeMenuDisplay(); // Set initial display state for menu panels
}

// --- Main execution logic ---
document.addEventListener('DOMContentLoaded', () => {
  const stored = localStorage.getItem('gameWinner');
  if (stored) {
    try {
      const { winners, kills } = JSON.parse(stored);
      const title = winners.length > 1 ? 'GAME OVER! Multiple Winners!' : 'GAME OVER!';
      const names = winners.join(', ');
      Swal.fire({
        title,
        html: winners.length > 1
          ? `The winners are <strong>${names}</strong> with <strong>${kills}</strong> kills each!`
          : `The winner is <strong>${names}</strong> with <strong>${kills}</strong> kills!`,
        icon: 'success',
        confirmButtonText: 'Play Again',
        allowOutsideClick: false,
        allowEscapeKey: false
      }).then(result => {
        if (result.isConfirmed) {
          console.log("SweetAlert: User confirmed, proceeding to menu.");
        }
      });
    } catch (e) {
      console.error("SweetAlert: Error parsing stored winner:", e);
    } finally {
      localStorage.removeItem('gameWinner');
      localStorage.removeItem('gameEndedTimestamp');
    }
  }

  if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
    initMenuUI();
  } else {
    const gameWrapper = document.getElementById('game-container');
    if (gameWrapper) {
      createGameUI(gameWrapper);
      const username = localStorage.getItem("username") || "Guest";
      const params = new URLSearchParams(window.location.search);
      const mapName = params.get('map');
      const gameId  = params.get('gameId');
      if (mapName && gameId) {
        console.log(`Auto-joining game: Map=${mapName}, GameID=${gameId}`);
      } else if (mapName) {
        console.log(`Auto-starting game: Map=${mapName}`);
      } else {
        console.warn("No map or game ID in URL; falling back to menu.");
        menu();
      }
    } else {
      console.error("game-container element not found!");
      menu();
    }
  }
});
