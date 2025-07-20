// menu.js

/*
     _____,,;;;`;        ;';;;,,_____
,~(  )  , )~~\ |        |/~( ,  (  )~;
' / / --`--,          .--'-- \ \ `
  /  \    | '          ` |    /  \
// fff ff
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

// Placeholder for external imports, adjust paths as needed
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createGameUI, initBulletHoles } from "./ui.js";
import { startGame, toggleSceneDetails } from "./game.js";
import { initNetwork, setActiveGameId } from "./network.js";
import { gamesRef, claimGameSlot, releaseGameSlot, slotsRef } from './firebase-config.js';
// Make sure you have this script tag in your HTML <head> or before your menu.js script:
// <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

// --- Start of engine.js content (included here as per your provided code) ---

// Export utility functions and classes
export const preload = src => {
    const img = new Image();
    img.src = src;
};

// Get the canvas element and its 2D rendering context
const canvas = document.getElementById('menuCanvas');
const ctx = canvas.getContext('2d');

const sensitivitySliderContainer = document.getElementById("sensitivity-slider-container");
const settingsBox = document.getElementById("settings-box");

const menuBG = document.getElementById("animatedBG");
  const hud = document.getElementById("hud");

const loadMenu = document.getElementById("loading-menu");

let canvasWidth = canvas.width;
let canvasHeight = canvas.height;

let menuSong = new Audio("https://codehs.com/uploads/7ab8d31b9bb147e3952841963f6f3769");
menuSong.volume = 0.4;
menuSong.loop = true;
menuSong.play();

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
     * Draws the text on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
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
    buttonImage.originalWidth  = originalWidth;
    buttonImage.originalHeight = originalHeight;
    buttonImage.originalX      = xPos;
    buttonImage.originalY      = yPos;
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
        xPos + (originalWidth  - hitboxWidth ) / 2,
        yPos + (originalHeight - hitboxHeight) / 2
    );
    buttonHitbox.setColor("rgba(0,0,0,0)");
    buttonHitbox.setLayer(15);
    buttonHitbox.onClick = onClickCallback;

    // animation constants
    const FRAME_RATE           = 1000 / 60;
    const NUM_ANIMATION_STEPS  = 10;
    const TARGET_SCALE_FACTOR  = 1.1;
    let animationInterval;

    // — hover animation —
    buttonHitbox.onHover = () => {
        clearInterval(animationInterval);
        buttonImage.currentAnimationStep = 0;

        animationInterval = setInterval(() => {
            const step = ++buttonImage.currentAnimationStep;
            let t = step / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1;
            const easedT = easeOutQuint(t);
            const scale = 1 + (TARGET_SCALE_FACTOR - 1) * easedT;

            // new image size & position
            const newW = originalWidth  * scale;
            const newH = originalHeight * scale;
            const dx   = (newW - originalWidth)  / 2;
            const dy   = (newH - originalHeight) / 2;
            const newX = xPos - dx;
            const newY = yPos - dy;

            buttonImage.setSize(newW, newH);
            buttonImage.setPosition(newX, newY);

            // mirror text offset + scale
            if (buttonText.text) {
                buttonText.font = `${buttonText.originalFontSize * scale}pt Arial`;
                buttonText.setPosition(
                    newX + textOffsetX * scale,
                    newY + textOffsetY * scale
                );
            }

            if (t === 1) clearInterval(animationInterval);
        }, FRAME_RATE);
    };

    // — unhover animation —
    buttonHitbox.onUnhover = () => {
        clearInterval(animationInterval);
        buttonImage.currentAnimationStep = 0;
        const startScale = buttonImage.width / originalWidth;

        animationInterval = setInterval(() => {
            const step = ++buttonImage.currentAnimationStep;
            let t = step / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1;
            const easedT = easeOutQuint(t);
            const scale = startScale - (startScale - 1) * easedT;

            const newW = originalWidth  * scale;
            const newH = originalHeight * scale;
            const dx   = (newW - originalWidth)  / 2;
            const dy   = (newH - originalHeight) / 2;
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
                // snap back exactly
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
    const buttonObject = { image: buttonImage, hitbox: buttonHitbox, text: buttonText };
    buttonObject.setText = function (newText) {
        this.text.setText(newText);
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
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a",
    1920 / 6, 1080 / 6, // Original width and height
    25 - 15, getHeight() / 2 - leftbuttonSpacing * 2, // Adjusted position
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions (slightly smaller than image)
    () => {
        console.log("Play button hit");
        playButtonHit(); // Call function to change menu state
    }
);
// playButton.setText("Play"); // REMOVED TEXT

let settingsButton = createAnimatedButton(
    "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 - leftbuttonSpacing * 0.5, // Position below Games
    1920 / 8, 1080 / 10,
    () => {
        console.log("Settings button hit");
        settingsButtonHit(); // Call new function for settings screen
    }
);
// settingsButton.setText("Settings"); // REMOVED TEXT

let careerButton = createAnimatedButton(
    "https://codehs.com/uploads/afd818ac19ff0bbd919c766a1625071e",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 0.5, // Position below Settings
    1920 / 8, 1080 / 10,
    () => {
        console.log("Career button hit");
        careerButtonHit(); // Call new function for career screen
    }
);
// careerButton.setText("Career"); // REMOVED TEXT

let loadoutButton = createAnimatedButton(
    "https://codehs.com/uploads/765a0c87dc6d5d571ff25f139003227f",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 1.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Loadout button hit");
        loadoutButtonHit(); // Call new function for loadout screen
    }
);

// Main Create Game Button (will be on the map selection screen)
let createGameBtn = createAnimatedButton(
    "https://codehs.com/uploads/31eb8424a7b74d1266c4e1e210845583", // Example image
    1920 / 6, 1080 / 6, // Original width and height
    getWidth() / 3 - 50, getHeight() - 250, // Position it below map options
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions
    () => {
        console.log("createGameBtn hit");
        createGameButtonHit();
    }
);

let gamesButton = createAnimatedButton(
    "https://codehs.com/uploads/2fe6d45e0875e166cfe5f0e5343fc3b5", // Provided games button image
    1920 / 6, 1080 / 6,
    getWidth() / 2 + 50, getHeight() - 250, // Position below Play
    1920 / 6 - 25, 1080 / 8,
    () => {
        console.log("Games button hit");
        gamesButtonHit();
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
    }
);


let playerCard = createAnimatedButton(
    "https://codehs.com/uploads/44ac54e5efa47170da279caa22d6e7cc", // Provided games button image
    1080/3, 1440/3,
    getWidth()/2 - ((1080/3)/2), getHeight()/2 - ((1440/3)/2), // Position below Play
    1080/3, 1440/3,
    () => {
        console.log("updateBoard button hit");
        playerCardHit();
    },
         getWidth()/2, getHeight()/2 + 170
);

 playerCard.setText(username); // REMOVED TEXT



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
    clearMenuCanvas(); // Clear anything previously on canvas
    // add(background); // REMOVED BACKGROUND
    sensitivitySliderContainer.style.display = "none"; // Or "block", depending on your CSS layout


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

    currentMenuObjects.push(playButton.image, playButton.hitbox, gamesButton.image, gamesButton.hitbox, settingsButton.image, settingsButton.hitbox, careerButton.image, careerButton.hitbox, loadoutButton.image, loadoutButton.hitbox);
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

    addBackButton(); // Add back button to this screen
}

/**
 * Handles the "Create Game" button click.
 * Uses SweetAlert2 for input and pushes game data to Firebase.
 */
async function createGameButtonHit() {
  const username = localStorage.getItem("username");
  if (!username?.trim()) {
    return Swal.fire("Error", "Please set your username first.", "error");
  }

  const { value: formValues } = await Swal.fire({
    title: "Create New Game",
    html:
      `<input id="swal-input1" class="swal2-input" placeholder="Game Name" value="${username}'s Game">` +
      `<select id="swal-input2" class="swal2-select">
         <option value="">Select Map</option>
         <option value="SigmaCity">SigmaCity</option>
         <option value="CrocodilosConstruction">CrocodilosConstruction</option>
       </select>` +
      `<select id="swal-input3" class="swal2-select">
         <option value="FFA">FFA</option>
       </select>`,
    focusConfirm: false,
    preConfirm: () => {
      const gameName = document.getElementById("swal-input1").value;
      const map      = document.getElementById("swal-input2").value;
      const mode     = document.getElementById("swal-input3").value;
      if (!gameName || !map || !mode) {
        Swal.showValidationMessage("Please fill all fields");
        return false;
      }
      return { gameName, map, gamemode: mode };
    }
  });
  if (!formValues) return menu();

  // 1️⃣ Push master record under /games
  const newGameRef = gamesRef.push();
  await newGameRef.set({
    gameName:   formValues.gameName,
    map:        formValues.map,
    gamemode:   formValues.gamemode,
    host:       username,
    ffaEnabled: true,
    createdAt:  firebase.database.ServerValue.TIMESTAMP,
    status:     "waiting"
  });
  const gameId = newGameRef.key;

  // 2️⃣ Claim a slot
  const slotResult = await claimGameSlot(username, formValues.map, true);
  if (!slotResult) {
    await newGameRef.remove();
    return Swal.fire("Error", "No free slots available. Game discarded.", "error")
      .then(menu);
  }
  const slotName = slotResult.slotName;
  await newGameRef.child("slot").set(slotName);
  await newGameRef.child("status").set("starting");

  // 3️⃣ Immediately write gameConfig under /gameSlots/{slotName}/gameConfig
  const configRef = dbRefs.gameSlotsRef.child(slotName).child("gameConfig");
  const initialDuration = 10 * 60;       // seconds
  const nowMs = Date.now();
  await configRef.set({
    gameDuration: initialDuration,
    startTime:    nowMs,
    endTime:      nowMs + initialDuration * 1000
  });

  // 4️⃣ Notify & join
  Swal.fire({
    title: "Game Created!",
    html:
      `Game: <b>${formValues.gameName}</b><br>` +
      `Map: <b>${formValues.map}</b><br>` +
      `Slot: <b>${slotName}</b>`,
    icon: "success",
    confirmButtonText: "Join Game"
  }).then(res => {
    if (res.isConfirmed) {
      // pass slotName (not gameId) into startGame
      startGame(username, formValues.map, true, true, slotName);
    } else {
      menu();
    }
  });
}

async function gamesButtonHit() {
    clearMenuCanvas();
    add(logo);
    let loadingText = new Text("Loading games...", "30pt Arial");
    loadingText.setColor("#ffffff");
    loadingText.setPosition(getWidth() / 2, getHeight() / 2);
    add(loadingText);
    currentMenuObjects.push(loadingText);

    try {
        const snapshot = await gamesRef.once('value');
        const gamesObj = snapshot.val() || {};

        const activeSlots = Object.entries(gamesObj)
            .filter(([id, game]) => game.status === "waiting" || game.status === "starting")
            .map(([id, game]) => ({
                id,
                gameName: game.gameName,    // ← include gameName
                host:     game.host,
                map:      game.map,
                createdAt: game.createdAt,
                slot:     game.slot
            }))
            .sort((a, b) => b.createdAt - a.createdAt);

        remove(loadingText);

        if (activeSlots.length === 0) {
            let none = new Text("No active games available. Create one!", "30pt Arial");
            none.setColor("#ffffff");
            none.setPosition(getWidth() / 2, getHeight() / 2);
            add(none);
            currentMenuObjects.push(none);
            addBackButton();
            return;
        }

        const GAMES_PER_PAGE = 4;
        const startIndex = currentPage * GAMES_PER_PAGE;
        const pageSlots = activeSlots.slice(startIndex, startIndex + GAMES_PER_PAGE);

        let yStart = 200;
        const entryHeight = 150;

        for (let i = 0; i < pageSlots.length; i++) {
            const slotInfo = pageSlots[i];
            const gameId   = slotInfo.id;
            const mapName  = slotInfo.map;
            const y = yStart + i * entryHeight;

            // Background hitbox
            let gameBg = createClickableRectangle(
                getWidth() * 0.1,
                y - 50,
                getWidth() * 0.8,
                100,
                "rgba(50,50,50,0.7)",
                () => {
                    console.log(`Joining game ${slotInfo.gameName} on map ${mapName}`);
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

            // Map details
            let detailsText = new Text(`Map: ${slotInfo.map}`, "15pt Arial");
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
                () => { currentPage--; gamesButtonHit(); },
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
                () => { currentPage++; gamesButtonHit(); },
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

        addBackButton();

    } catch (error) {
        console.error("Error fetching slots:", error);
        remove(loadingText);
        let errorText = new Text("Error loading games: " + error.message, "20pt Arial");
        errorText.setColor("#ff0000");
        errorText.setPosition(getWidth() / 2, getHeight() / 2);
        add(errorText);
        currentMenuObjects.push(errorText);
        addBackButton();
    }
}
/**
 * Adds a "Back to Menu" button to the current screen.
 */
function addBackButton() {
    let backButton = createAndAddButton(
        "https://codehs.com/uploads/4bcd4b492845bb3587c71c211d29903d", // Left arrow image
        1080/16, 1080/16, // Top-left corner
        1920/16, 1080/16, // Size for back button
        () => {
            currentPage = 0; // Reset page when going back to main menu
            menu(); // Go back to main menu
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
    add(logo);

    // Get the HTML elements for the sensitivity slider and settings box


    // Show these elements
    if (sensitivitySliderContainer) {
        sensitivitySliderContainer.style.display = "flex"; // Or "block", depending on your CSS layout
    }
    if (settingsBox) {
        settingsBox.style.display = "block"; // Or "flex", depending on your CSS layout
    }


    addBackButton(); // Keep the back button to return to the main menu

    // When going back from settings, hide the HTML settings elements again
    const backButton = currentMenuObjects.find(obj => obj instanceof ImageShape && obj.x === 50 && obj.y === 50); // Assuming this is your back button image
    if (backButton && backButton.hitbox) {
        // Override the original onClick to also hide settings elements
        backButton.hitbox.onClick = () => {
            currentPage = 0;
            menu();
            if (sensitivitySliderContainer) {
                sensitivitySliderContainer.style.display = "none";
            }
            if (settingsBox) {
                settingsBox.style.display = "none";
            }
        };
    }
}

/**
 * Handles the "Career" button click.
 * Clears the current menu and displays a placeholder career screen.
 */
function careerButtonHit() {
    clearMenuCanvas();
    add(logo);


    // You can add your career UI elements here
    let careerText = new Text("View your stats and achievements.", "30pt Arial");
    careerText.setColor("#aaaaaa");
    careerText.setPosition(getWidth() / 2, getHeight() / 2);
    add(careerText);
    currentMenuObjects.push(careerText);

    addBackButton();
}

/**
 * Handles the "Loadout" button click.
 * Clears the current menu and displays a placeholder loadout screen.
 */
function loadoutButtonHit() {
    clearMenuCanvas();
    add(logo);


    // You can add your loadout UI elements here
    let loadoutText = new Text("Equip weapons and gear.", "30pt Arial");
    loadoutText.setColor("#aaaaaa");
    loadoutText.setPosition(getWidth() / 2, getHeight() / 2);
    add(loadoutText);
    currentMenuObjects.push(loadoutText);

    addBackButton();
}


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

    const sensitivityRange = document.getElementById("sensitivity-range");
    const sensitivityInput = document.getElementById("sensitivity-input");
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
        saveUsernameBtn.addEventListener("click", () => {
            const val = usernameInput.value.trim();
            if (val.length > 0) {
                localStorage.setItem("username", val);
                username = val;
                playerCard.setText(username); // REMOVED TEXT
                // Hide the HTML username prompt
                showPanel(null);

                // Show the canvas and draw the main menu
                canvas.style.display = 'block';
                menu();

                // Hide the HTML game logo
                document.getElementById("game-logo").classList.add("hidden");
                const menuOverlayElement = document.getElementById('menu-overlay');
                if (menuOverlayElement) {
                    menuOverlayElement.style.display = 'none';
                }

            } else {
                console.warn("Username cannot be empty!");
                Swal.fire('Warning', 'Username cannot be empty!', 'warning');
            }
        });
    }

    // --- Sensitivity Slider Logic ---
    function setSensitivity(newVal) {
        const v = Math.min(parseFloat(sensitivityRange.max), Math.max(parseFloat(sensitivityRange.min), newVal)).toFixed(2);
        sensitivityRange.value = v;
        sensitivityInput.value = v;
        localStorage.setItem("sensitivity", v);
        document.dispatchEvent(new CustomEvent("updateSensitivity", { detail: parseFloat(v) }));
    }

    const savedSens = localStorage.getItem("sensitivity") || "5.00";
    if (sensitivityRange && sensitivityInput) {
        setSensitivity(parseFloat(savedSens));
        sensitivityRange.addEventListener('input', () => {
            setSensitivity(sensitivityRange.value);
        });
        sensitivityInput.addEventListener('change', () => {
            setSensitivity(parseFloat(sensitivityInput.value));
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
    // Check for a stored winner from a previous game
    const storedWinner = localStorage.getItem('gameWinner');
    if (storedWinner) {
        try {
            const winner = JSON.parse(storedWinner);
            console.log("SweetAlert: Displaying winner from previous game session.");
            Swal.fire({
                title: 'GAME OVER!',
                html: `The winner is <strong>${winner.username}</strong> with <strong>${winner.kills}</strong> kills!`,
                icon: 'success',
                confirmButtonText: 'Play Again',
                allowOutsideClick: false, // Prevent closing by clicking outside
                allowEscapeKey: false // Prevent closing by pressing Escape
            }).then((result) => {
                if (result.isConfirmed) {
                    console.log("SweetAlert: User confirmed, proceeding to menu.");
                }
            });

            // Clean up localStorage immediately after displaying the winner
            localStorage.removeItem('gameWinner');
            localStorage.removeItem('gameEndedTimestamp'); // Also remove the timestamp if you stored it
        } catch (e) {
            console.error("SweetAlert: Error parsing stored winner data from localStorage:", e);
            localStorage.removeItem('gameWinner'); // Clear corrupted data
            localStorage.removeItem('gameEndedTimestamp');
        }
    }


    // Always initialize the menu UI if we are on index.html or the root path
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        console.log("Attempting to initialize Menu UI on index.html...");
        initMenuUI(); // Initialize the HTML-based menu
        // menu(); // Calling menu() here twice if initMenuUI also calls it can be redundant
        console.log("Menu UI initialization process started.");
    } else {
        const gameWrapper = document.getElementById('game-container');
        if (gameWrapper) {
            createGameUI(gameWrapper);
            // This part of the else block for starting game on other paths
            // usually means joining an existing game via URL params
            const username = localStorage.getItem("username") || "Guest";
            const urlParams = new URLSearchParams(window.location.search);
            const mapName = urlParams.get('map');
            const gameId = urlParams.get('gameId'); // Get gameId from URL
            if (mapName && gameId) {
                console.log(`Auto-joining game from URL: Map=${mapName}, GameID=${gameId}`);

            } else if (mapName) {
                console.log(`Auto-starting game from URL (no gameId): Map=${mapName}`);

            } else {
                console.warn("No map or game ID found in URL parameters, cannot auto-start game.");
                // If on a non-root path but no game info, fallback to menu
                menu();
            }
        } else {
            console.error("game-container element not found!");
            menu(); // Fallback to menu if no game container
        }
    }
});
