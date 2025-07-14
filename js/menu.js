// menu.js

/*
    _____,,;;;`;        ;';;;,,_____
,~( ) , )~~\ |        |/~( , ( )~;
' / / --`--,            .--'-- \ \ `
  / \   | '            ` |   / \

horse power
*/

// --- All imports moved to the top ---
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createGameUI, initBulletHoles } from "./ui.js";
import { startGame, toggleSceneDetails, stopGameAnimation, disconnectPlayer } from "./game.js"; // Added stopGameAnimation, disconnectPlayer
import { initNetwork, localPlayerId, dbRefs } from "./network.js"; // Added dbRefs
import { getMenuDbRefs, getGameDbRefs } from "./firebase-config.js"; // Added getMenuDbRefs, getGameDbRefs

// --- Start of engine.js content (integrated into menu.js) ---

// Export utility functions and classes
export const preload = src => {
    const img = new Image();
    img.src = src;
};

// Get the canvas element and its 2D rendering context
const canvas = document.getElementById('menuCanvas');
const ctx = canvas.getContext('2d');

let canvasWidth = canvas.width;
let canvasHeight = canvas.height;

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
 */
export function removeAll() {
    shapes.length = 0;
    // Also clear clickable shapes when clearing all drawn shapes
    clickableShapes.length = 0;
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
        this.visible = true; // New: control visibility
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

    /**
     * Sets the visibility of the shape.
     * @param {boolean} v - True to make visible, false to hide.
     */
    setVisible(v) { this.visible = v; }
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
        if (!this.visible) return; // Only draw if visible
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
        this.borderColor = null; // New: border color
        this.borderWidth = 0; // New: border width
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
     * Sets the border color of the rectangle.
     * @param {string} color - The color string.
     */
    setBorderColor(color) {
        this.borderColor = color;
    }

    /**
     * Sets the width of the rectangle's border.
     * @param {number} w - The border width in pixels.
     */
    setBorderWidth(w) {
        this.borderWidth = w;
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
        if (!this.visible) return; // Only draw if visible
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        if (this.borderWidth > 0) {
            ctx.lineWidth = this.borderWidth;
            ctx.strokeStyle = this.borderColor || 'black';
            ctx.strokeRect(this.x, this.y, this.width, this.height);
        }
        ctx.restore();
    }
}

/**
 * Represents a text shape.
 */
export class Text extends Shape {
    constructor(text, font) {
        super();
        this.text = text;
        this.font = font || '16pt Tahoma';
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.layer = 0;
        this.opacity = 1.0;
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
        this.textAlign = 'center'; // Default to center for easier positioning
        this.textBaseline = 'middle'; // Default to middle for easier positioning
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
     * Sets the font of the text.
     * @param {string} font - The new font string (e.g., '24pt Arial').
     */
    setFont(font) {
        this.font = font;
    }

    /**
     * Sets the anchor point for positioning.
     * @param {object} anchor - An object with horizontal and vertical properties (e.g., {horizontal: 'center', vertical: 'middle'}).
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
        this.textAlign = horizontal;
        this.textBaseline = vertical;
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
        if (!this.visible) return; // Only draw if visible
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.font = this.font;
        ctx.textAlign = this.textAlign;
        ctx.textBaseline = this.textBaseline;
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

    /**
     * Draws the image on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        if (!this.loaded || !this.visible) return; // Skip drawing until image is loaded or if not visible
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
let animationFrameId = null; // To store the requestAnimationFrame ID

function gameLoop() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    // Sort and draw shapes by layer to ensure correct rendering order
    shapes.sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let shape of shapes) {
        shape.draw(ctx);
    }
    animationFrameId = requestAnimationFrame(gameLoop);
}

// Start the game loop
gameLoop();

/**
 * Makes a shape clickable by associating it with an onClick callback.
 * @param {Shape} shape - The shape to make clickable.
 * @param {Function} onClick - The function to call when the shape is clicked.
 */
export function makeButton(shape, onClick) {
    // Ensure the shape is visible to be clickable
    if (shape.visible) {
        clickableShapes.push({ shape, onClick });
    }
}

// Event listener for mouse clicks on the canvas
canvas.addEventListener("click", function(event) {
    const rect = canvas.getBoundingClientRect();
    // Calculate scaling factors to convert CSS pixels to canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get click coordinates in canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // Check if the click occurred within any clickable shape
    for (const entry of clickableShapes) {
        const s = entry.shape;
        if (!s.visible) continue; // Only check visible shapes

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            if (inX && inY) {
                entry.onClick(); // Trigger the click callback
                break; // Stop after the first hit
            }
        }
        if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            // Check if click is within the circle's radius
            if (Math.sqrt(dx * dx + dy * dy) <= s.getRadius()) {
                entry.onClick();
                break;
            }
        }
        if (s instanceof ImageShape) {
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            if (inX && inY) {
                entry.onClick();
                break;
            }
        }
    }
});

// Event listener for mouse movement on the canvas
canvas.addEventListener("mousemove", function(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Convert from CSS pixels into canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    let hoveringAny = false; // Flag to track if mouse is hovering over any clickable shape

    for (const entry of clickableShapes) {
        const s = entry.shape;
        if (!s.visible) continue; // Only check visible shapes

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
        else if (s instanceof ImageShape) {
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            isHovering = inX && inY;
        }

        if (isHovering) hoveringAny = true;

        // Handle hover state callbacks
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
logo.setSize(100, 100);
logo.setPosition(getWidth() / 2, getHeight() / 32);
logo.setLayer(10); // Ensure logo is drawn on top

// Background rectangle for the menu
let background = new Rectangle(getWidth(), getHeight());
background.setLayer(1); // Drawn behind other elements
background.setColor("#222222");

const TARGET_SCALE_FACTOR = 1.1; // Scale up to 110% on hover
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
 * Creates and sets up an image button with hover animations and click detection.
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
function createAnimatedButton(imageUrl, originalWidth, originalHeight, xPos, yPos, hitboxWidth, hitboxHeight, onClickCallback) {
    let buttonImage = new ImageShape(imageUrl);
    buttonImage.originalWidth = originalWidth;
    buttonImage.originalHeight = originalHeight;
    buttonImage.setPosition(xPos, yPos);
    buttonImage.setSize(originalWidth, originalHeight);
    buttonImage.setLayer(3); // Layer for the image
    buttonImage.originalX = xPos;
    buttonImage.originalY = yPos;
    buttonImage.currentAnimationStep = 0; // Tracks the current step in the animation

    let buttonHitbox = new Rectangle(hitboxWidth, hitboxHeight);
    // Position the hitbox relative to the button's actual position, centering vertically
    buttonHitbox.setPosition(xPos, yPos + (originalHeight - hitboxHeight) / 2);
    buttonHitbox.setColor("rgba(255, 0, 0, 0.0)"); // Transparent hitbox (can be made visible for debugging)
    buttonHitbox.setLayer(15); // Layer for the hitbox (should be on top to capture events)

    // Only make buttons interactive if we are in the menu state or for specific escape menu buttons
    makeButton(buttonHitbox, onClickCallback); // Register the hitbox as a clickable button

    let animationInterval = null; // Variable to hold the interval ID for animation

    // Callback for when the mouse hovers over the button's hitbox
    buttonHitbox.onHover = () => {
        if (animationInterval) {
            clearInterval(animationInterval); // Clear any existing animation
        }
        buttonImage.currentAnimationStep = 0; // Reset animation step

        animationInterval = setInterval(() => {
            buttonImage.currentAnimationStep++;
            let t = buttonImage.currentAnimationStep / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1; // Clamp t to 1

            let easedT = easeOutQuint(t); // Apply easing function
            let currentScale = 1.0 + (TARGET_SCALE_FACTOR - 1.0) * easedT; // Calculate current scale

            const newWidth = buttonImage.originalWidth * currentScale;
            const newHeight = buttonImage.originalHeight * currentScale;

            // Adjust position to keep the image centered during scaling
            const newX = buttonImage.originalX;
            const newY = buttonImage.originalY - (newHeight - buttonImage.originalHeight) / 2;

            buttonImage.setSize(newWidth, newHeight);
            buttonImage.setPosition(newX, newY);

            if (t === 1) {
                clearInterval(animationInterval); // Stop animation when complete
            }
        }, FRAME_RATE);
    };

    // Callback for when the mouse leaves the button's hitbox
    buttonHitbox.onUnhover = () => {
        if (animationInterval) {
            clearInterval(animationInterval); // Clear any existing animation
        }
        buttonImage.currentAnimationStep = 0; // Reset animation step
        const initialScaleForUnhover = buttonImage.width / buttonImage.originalWidth;
        const scaleDifference = initialScaleForUnhover - 1.0;

        animationInterval = setInterval(() => {
            buttonImage.currentAnimationStep++;
            let t = buttonImage.currentAnimationStep / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1; // Clamp t to 1

            let easedT = easeOutQuint(t); // Apply easing function
            let currentScale = initialScaleForUnhover - (scaleDifference * easedT);

            if (currentScale < 1.0) currentScale = 1.0; // Ensure scale doesn't go below original

            const newWidth = buttonImage.originalWidth * currentScale;
            const newHeight = buttonImage.originalHeight * currentScale;

            // Adjust position to keep the image centered during scaling
            const newX = buttonImage.originalX;
            const newY = buttonImage.originalY - (newHeight - buttonImage.originalHeight) / 2;

            buttonImage.setSize(newWidth, newHeight);
            buttonImage.setPosition(newX, newY);

            if (t === 1) {
                clearInterval(animationInterval); // Stop animation when complete
                // Reset to original size and position precisely
                buttonImage.setSize(buttonImage.originalWidth, buttonImage.originalHeight);
                buttonImage.setPosition(buttonImage.originalX, buttonImage.originalY);
            }
        }, FRAME_RATE);
    };
    return { image: buttonImage, hitbox: buttonHitbox };
}

// --- Menu State Management ---
const MENU_STATE = {
    MAIN: 'main',
    PLAY: 'play',
    SETTINGS: 'settings',
    ESCAPE_MAIN: 'escape_main',
    ESCAPE_SETTINGS: 'escape_settings',
    GAME_OVER: 'game_over' // New state for showing winner
};
let currentMenuState = MENU_STATE.MAIN;
let menuDbRefs; // Firebase refs for menu database
let gamesRef; // Reference to the 'games' collection

// Elements for different menu states
let mainMenuElements = [];
let playMenuElements = [];
let gameLobbyElements = []; // To store dynamic game lobby boxes
let escapeMenuElements = [];
let escapeSettingsElements = [];
let gameOverElements = []; // Elements for the game over screen

// Winner display elements
let winnerText = null;
let winnerBackground = null;
let returnToMenuButton = null;

// Function to set visibility for a group of shapes
function setShapesVisible(shapesArray, visible) {
    shapesArray.forEach(shape => {
        shape.setVisible(visible);
        // If it's a hitbox, update clickableShapes array
        if (shape instanceof Rectangle || shape instanceof Circle || shape instanceof ImageShape) {
            const index = clickableShapes.findIndex(entry => entry.shape === shape);
            if (visible && index === -1) {
                makeButton(shape, shape.onClick); // Re-add if it was removed
            } else if (!visible && index !== -1) {
                clickableShapes.splice(index, 1); // Remove if hidden
            }
        }
    });
}

/**
 * Clears all current menu elements and sets up the new state.
 * @param {string} newState - The target menu state (e.g., MENU_STATE.MAIN).
 */
function transitionToMenuState(newState) {
    // Hide all existing menu elements
    setShapesVisible(mainMenuElements, false);
    setShapesVisible(playMenuElements, false);
    setShapesVisible(gameLobbyElements, false); // Clear dynamic lobbies
    setShapesVisible(escapeMenuElements, false);
    setShapesVisible(escapeSettingsElements, false);
    setShapesVisible(gameOverElements, false);
    removeAll(); // Clear all shapes from canvas

    // Re-add base elements
    add(background);
    add(logo);

    currentMenuState = newState;
    console.log("Transitioning to menu state:", newState);

    // Show elements for the new state
    if (newState === MENU_STATE.MAIN) {
        setShapesVisible(mainMenuElements, true);
        mainMenuElements.forEach(s => add(s));
        // Re-add hitboxes for main menu buttons
        makeButton(playButton.hitbox, playButton.hitbox.onClick);
        makeButton(settingsButton.hitbox, settingsButton.hitbox.onClick);
        makeButton(careerButton.hitbox, careerButton.hitbox.onClick);
        makeButton(loadoutButton.hitbox, loadoutButton.hitbox.onClick);
        canvas.style.display = 'block'; // Ensure canvas is visible
        document.getElementById("menu-overlay").style.display = 'none'; // Hide HTML overlay
    } else if (newState === MENU_STATE.PLAY) {
        setShapesVisible(playMenuElements, true);
        playMenuElements.forEach(s => add(s));
        makeButton(createGameButton.hitbox, createGameButton.hitbox.onClick);
        makeButton(backButton.hitbox, backButton.hitbox.onClick);
        updateGameLobbies(); // Refresh and display game lobbies
    } else if (newState === MENU_STATE.ESCAPE_MAIN) {
        setShapesVisible(escapeMenuElements, true);
        escapeMenuElements.forEach(s => add(s));
        makeButton(escapePlayButton.hitbox, escapePlayButton.hitbox.onClick);
        makeButton(escapeSettingsButton.hitbox, escapeSettingsButton.hitbox.onClick);
        makeButton(escapeExitButton.hitbox, escapeExitButton.hitbox.onClick);
    } else if (newState === MENU_STATE.ESCAPE_SETTINGS) {
        setShapesVisible(escapeSettingsElements, true);
        escapeSettingsElements.forEach(s => add(s));
        makeButton(escapeSettingsBackButton.hitbox, escapeSettingsBackButton.hitbox.onClick);
        // HTML settings panel will be shown/hidden by initMenuUI
    } else if (newState === MENU_STATE.GAME_OVER) {
        setShapesVisible(gameOverElements, true);
        gameOverElements.forEach(s => add(s));
        makeButton(returnToMenuButton.hitbox, returnToMenuButton.hitbox.onClick);
    }
}

// Button Definitions using the reusable createAnimatedButton function
let playButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a",
    1920 / 6, 1080 / 6, // Original width and height
    0, getHeight() / 4, // Position
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions (slightly smaller than image)
    () => {
        console.log("Play button hit");
        transitionToMenuState(MENU_STATE.PLAY);
    }
);

let settingsButton = createAnimatedButton(
    "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8",
    1920 / 8, 1080 / 8,
    0 + 15, getHeight() / 4 + leftbuttonSpacing + playButton.image.y / 8,
    1920 / 8, 1080 / 10,
    () => {
        console.log("Settings button hit");
        // For now, this will still show the HTML settings menu
        document.getElementById("menu-overlay").style.display = 'flex';
        document.getElementById("controls-menu").classList.remove("hidden");
        document.getElementById("controls-menu").style.display = 'flex';
        canvas.style.display = 'none'; // Hide canvas when HTML settings are shown
    }
);

let careerButton = createAnimatedButton(
    "https://codehs.com/uploads/afd818ac19ff0bbd919c766a1625071e",
    1920 / 8, 1080 / 8,
    0 + 15, getHeight() / 4 + leftbuttonSpacing * 2 + playButton.image.y / 8,
    1920 / 8, 1080 / 10,
    () => { console.log("Career button hit"); }
);

let loadoutButton = createAnimatedButton(
    "https://codehs.com/uploads/765a0c87dc6d5d571ff25f139003227f",
    1920 / 8, 1080 / 8,
    0 + 15, getHeight() / 4 + leftbuttonSpacing * 3 + playButton.image.y / 8,
    1920 / 8, 1080 / 10,
    () => { console.log("Loadout button hit"); }
);

// New: Create Game button
let createGameButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Reusing play button image for now
    1920 / 8, 1080 / 8,
    getWidth() / 2 - (1920 / 16), getHeight() - 150, // Position at bottom center
    1920 / 8, 1080 / 10,
    async () => {
        console.log("Create Game button hit");
        const snapshot = await gamesRef.once('value');
        const currentGames = snapshot.val();
        const numGames = currentGames ? Object.keys(currentGames).length : 0;

        if (numGames >= 2) {
            console.warn("Cannot create more than 2 games at a time.");
            // Optionally display a message to the user on canvas
            const messageText = new Text("Max 2 games active. Join an existing one!", "30pt Arial");
            messageText.setPosition(getWidth() / 2, getHeight() / 2 + 100);
            messageText.setColor("red");
            messageText.setLayer(20);
            add(messageText);
            setTimeout(() => remove(messageText), 3000);
            return;
        }

        const gameId = numGames === 0 ? "game1" : "game2"; // Simple assignment for now
        const username = localStorage.getItem("username") || "Guest";

        // Create initial game data in Firebase
        await gamesRef.child(gameId).set({
            mapName: "CrocodilosConstruction", // Default map for now
            playerCount: 0, // Will be updated by players joining
            maxPlayers: 10,
            gameMode: "FFA",
            timer: 600, // 10 minutes in seconds
            maxKills: 50,
            status: "lobby", // lobby, active, finished
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            host: username // Store host for initial creation
        });

        // Join the newly created game
        joinGame(gameId, "CrocodilosConstruction");
    }
);
playMenuElements.push(createGameButton.image, createGameButton.hitbox);

// New: Back button for Play menu
let backButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Reusing play button image
    1920 / 12, 1080 / 12, // Smaller size
    50, 50, // Top-left
    1920 / 12, 1080 / 12,
    () => {
        console.log("Back button hit");
        transitionToMenuState(MENU_STATE.MAIN);
    }
);
playMenuElements.push(backButton.image, backButton.hitbox);

/**
 * Initializes the main menu by adding all primary menu elements to the canvas.
 */
function setupMainMenu() {
    mainMenuElements = [
        playButton.image, playButton.hitbox,
        settingsButton.image, settingsButton.hitbox,
        careerButton.image, careerButton.hitbox,
        loadoutButton.image, loadoutButton.hitbox
    ];
    mainMenuElements.forEach(s => add(s));
}

// Escape Menu buttons
let escapePlayButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Play
    1920 / 8, 1080 / 8,
    getWidth() / 2 - (1920 / 16), getHeight() / 2 - 100,
    1920 / 8, 1080 / 10,
    () => {
        console.log("Escape Play button hit");
        // Resume game, hide menu
        toggleEscapeMenu(false);
    }
);
escapeMenuElements.push(escapePlayButton.image, escapePlayButton.hitbox);

let escapeSettingsButton = createAnimatedButton(
    "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8", // Settings
    1920 / 8, 1080 / 8,
    getWidth() / 2 - (1920 / 16), getHeight() / 2,
    1920 / 8, 1080 / 10,
    () => {
        console.log("Escape Settings button hit");
        transitionToMenuState(MENU_STATE.ESCAPE_SETTINGS);
        // Show HTML settings panel
        document.getElementById("menu-overlay").style.display = 'flex';
        document.getElementById("controls-menu").classList.remove("hidden");
        document.getElementById("controls-menu").style.display = 'flex';
        canvas.style.display = 'none'; // Hide canvas when HTML settings are shown
    }
);
escapeMenuElements.push(escapeSettingsButton.image, escapeSettingsButton.hitbox);

let escapeExitButton = createAnimatedButton(
    "https://codehs.com/uploads/afd818ac19ff0bbd919c766a1625071e", // Exit (using Career image for now)
    1920 / 8, 1080 / 8,
    getWidth() / 2 - (1920 / 16), getHeight() / 2 + 100,
    1920 / 8, 1080 / 10,
    () => {
        console.log("Escape Exit button hit");
        disconnectAndReturnToMenu();
    }
);
escapeMenuElements.push(escapeExitButton.image, escapeExitButton.hitbox);

// Escape Settings Back button
let escapeSettingsBackButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Back
    1920 / 12, 1080 / 12,
    50, 50,
    1920 / 12, 1080 / 12,
    () => {
        console.log("Escape Settings Back button hit");
        document.getElementById("menu-overlay").style.display = 'none'; // Hide HTML settings
        document.getElementById("controls-menu").classList.add("hidden");
        canvas.style.display = 'block'; // Show canvas again
        transitionToMenuState(MENU_STATE.ESCAPE_MAIN);
    }
);
escapeSettingsElements.push(escapeSettingsBackButton.image, escapeSettingsBackButton.hitbox);


/**
 * Function called when the "Play" button (canvas-drawn) is clicked.
 * Clears the current menu and displays the canvas-based map selection options.
 */
function playButtonHit() {
    // This function is now replaced by the onClick of playButton which calls transitionToMenuState(MENU_STATE.PLAY)
}

/**
 * Updates the display of active game lobbies on the canvas.
 * Fetches data from Firebase and creates/updates game boxes.
 */
function updateGameLobbies() {
    // Clear existing lobby elements
    setShapesVisible(gameLobbyElements, false);
    gameLobbyElements = [];
    removeAll(); // Clear all shapes from canvas
    add(background);
    add(logo);
    setShapesVisible(playMenuElements, true); // Re-add play menu elements
    playMenuElements.forEach(s => add(s));
    makeButton(createGameButton.hitbox, createGameButton.hitbox.onClick);
    makeButton(backButton.hitbox, backButton.hitbox.onClick);


    gamesRef.on('value', (snapshot) => {
        // Clear previous lobby displays
        gameLobbyElements.forEach(shape => remove(shape));
        gameLobbyElements = [];

        const games = snapshot.val();
        let yOffset = 150; // Starting Y position for the first game box
        const boxWidth = 400;
        const boxHeight = 150;
        const padding = 20;

        if (!games) {
            const noGamesText = new Text("No active games. Create one!", "30pt Arial");
            noGamesText.setPosition(getWidth() / 2, getHeight() / 2);
            noGamesText.setColor("white");
            noGamesText.setLayer(5);
            add(noGamesText);
            gameLobbyElements.push(noGamesText);
            return;
        }

        Object.entries(games).forEach(([gameId, gameData], index) => {
            const xPos = getWidth() / 2 - boxWidth / 2;
            const yPos = yOffset + index * (boxHeight + padding);

            // Game box background
            const gameBox = new Rectangle(boxWidth, boxHeight);
            gameBox.setPosition(xPos, yPos);
            gameBox.setColor("#333333");
            gameBox.setBorderColor("#6a0dad");
            gameBox.setBorderWidth(5);
            gameBox.setLayer(2);
            add(gameBox);
            gameLobbyElements.push(gameBox);

            // Map Name Text
            const mapNameText = new Text(gameData.mapName, "24pt Arial");
            mapNameText.setPosition(xPos + boxWidth / 2, yPos + 30);
            mapNameText.setColor("white");
            mapNameText.setLayer(3);
            add(mapNameText);
            gameLobbyElements.push(mapNameText);

            // Player Count Text
            const playerCountText = new Text(`Players: ${gameData.playerCount || 0}/${gameData.maxPlayers}`, "18pt Arial");
            playerCountText.setPosition(xPos + boxWidth / 2, yPos + 70);
            playerCountText.setColor("white");
            playerCountText.setLayer(3);
            add(playerCountText);
            gameLobbyElements.push(playerCountText);

            // Gamemode Text
            const gameModeText = new Text(`Mode: ${gameData.gameMode}`, "18pt Arial");
            gameModeText.setPosition(xPos + boxWidth / 2, yPos + 100);
            gameModeText.setColor(gameData.gameMode === "FFA" ? "lightgreen" : "grey"); // Grey out TDM
            gameModeText.setLayer(3);
            add(gameModeText);
            gameLobbyElements.push(gameModeText);

            // Join button (using the game box as the clickable area)
            makeButton(gameBox, () => {
                console.log(`Joining game: ${gameId} on map: ${gameData.mapName}`);
                joinGame(gameId, gameData.mapName);
            });
        });
    });
}

/**
 * Initiates joining a game.
 * @param {string} gameId - The ID of the game to join (e.g., "game1").
 * @param {string} mapName - The name of the map for the game.
 */
async function joinGame(gameId, mapName) {
    const username = localStorage.getItem("username") || "Guest";
    const detailsEnabled = localStorage.getItem("detailsEnabled") === "true";

    // Hide menu elements
    document.getElementById("menu-overlay").classList.add("hidden");
    canvas.style.display = 'none';

    // Show game container
    const gameWrapper = document.getElementById('game-container');
    if (gameWrapper) {
        gameWrapper.style.display = 'block';
        createGameUI(gameWrapper);
        await initNetwork(username, gameId); // Pass gameId instead of mapName
        startGame(username, mapName, detailsEnabled); // Pass mapName to startGame for scene init
        console.log(`Game started for ID: ${gameId}, Map: ${mapName}, Username: ${username}, Details Enabled: ${detailsEnabled}.`);
    } else {
        console.error("game-container element not found! Cannot start game.");
    }
}

let isGamePaused = false; // Track if the game is paused (for escape menu)

/**
 * Toggles the escape menu visibility and pauses/resumes the game.
 * @param {boolean|null} forceState - Optional. If true, forces menu open; if false, forces menu closed.
 */
export function toggleEscapeMenu(forceState = null) {
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer || gameContainer.style.display === 'none') {
        // Not in game, or game container not visible, so don't show escape menu
        return;
    }

    if (forceState !== null) {
        isGamePaused = forceState;
    } else {
        isGamePaused = !isGamePaused;
    }

    if (isGamePaused) {
        console.log("Game paused, showing escape menu.");
        stopGameAnimation(true); // Stop game animation
        canvas.style.display = 'block'; // Show canvas for escape menu
        transitionToMenuState(MENU_STATE.ESCAPE_MAIN);
        // Hide game UI elements that are not part of the escape menu
        document.getElementById("hud").style.display = "none";
        document.getElementById("crosshair").style.display = "none";
        document.body.classList.remove("game-active"); // Release pointer lock
    } else {
        console.log("Game resumed, hiding escape menu.");
        stopGameAnimation(false); // Resume game animation
        canvas.style.display = 'none'; // Hide canvas
        // Show game UI elements
        document.getElementById("hud").style.display = "block";
        document.getElementById("crosshair").style.display = "block";
        document.body.classList.add("game-active"); // Re-acquire pointer lock
        // Ensure HTML settings panel is hidden if it was open
        document.getElementById("menu-overlay").style.display = 'none';
        document.getElementById("controls-menu").classList.add("hidden");
    }
}

/**
 * Handles disconnection from the game and returns to the main menu.
 */
export function disconnectAndReturnToMenu(winnerName = null) {
    console.log("Disconnecting and returning to menu.");
    // 1. Stop game animation
    stopGameAnimation(true);

    // 2. Disconnect player from Firebase (if connected)
    disconnectPlayer(); // This function should be implemented in network.js

    // 3. Clear Three.js scene (handled by game.js cleanup)
    // 4. Hide game container and show menu canvas
    document.getElementById("game-container").style.display = 'none';
    document.getElementById("hud").style.display = "none";
    document.getElementById("crosshair").style.display = "none";
    document.body.classList.remove("game-active"); // Release pointer lock

    if (winnerName) {
        showGameOverScreen(winnerName);
    } else {
        transitionToMenuState(MENU_STATE.MAIN);
    }
}

/**
 * Displays the game over screen with the winner's name.
 * @param {string} winnerName - The name of the winning player.
 */
function showGameOverScreen(winnerName) {
    removeAll(); // Clear all shapes

    winnerBackground = new Rectangle(getWidth(), getHeight());
    winnerBackground.setColor("rgba(0, 0, 0, 0.8)");
    winnerBackground.setLayer(1);
    add(winnerBackground);
    gameOverElements.push(winnerBackground);

    winnerText = new Text(`${winnerName} won the game!`, "60pt Arial");
    winnerText.setPosition(getWidth() / 2, getHeight() / 2 - 50);
    winnerText.setColor("gold");
    winnerText.setLayer(10);
    add(winnerText);
    gameOverElements.push(winnerText);

    returnToMenuButton = createAnimatedButton(
        "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Reusing play button image
        1920 / 8, 1080 / 8,
        getWidth() / 2 - (1920 / 16), getHeight() / 2 + 100,
        1920 / 8, 1080 / 10,
        () => {
            console.log("Return to menu button hit.");
            transitionToMenuState(MENU_STATE.MAIN);
        }
    );
    add(returnToMenuButton.image);
    add(returnToMenuButton.hitbox);
    gameOverElements.push(returnToMenuButton.image, returnToMenuButton.hitbox);

    transitionToMenuState(MENU_STATE.GAME_OVER);
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
    const controlsMenu = document.getElementById("controls-menu");

    // These elements are assumed to be part of the HTML structure,
    // distinct from the canvas-drawn buttons.
    const htmlPlayButton = document.getElementById("play-button");
    const htmlSettingsButton = document.getElementById("settings-button");
    const htmlCareerButton = document.getElementById("career-button");
    const htmlLoadoutButton = document.getElementById("loadout-button"); // Added loadout button

    const saveUsernameBtn = document.getElementById("save-username-btn");
    const usernameInput = document.getElementById("username-input");

    const sensitivityRange = document.getElementById("sensitivity-range");
    const sensitivityInput = document.getElementById("sensitivity-input");
    const toggleDetailsBtn = document.getElementById("toggle-details-btn");

    // Map selection buttons (HTML-based, now largely replaced by canvas lobbies)
    const mapButtons = document.querySelectorAll(".map-btn");

    let username = localStorage.getItem("username");
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
        showPanel(null); // Ensure all sub-panels are hidden on initial load
    }

    // --- Event Listeners for Main Menu Buttons (HTML-based) ---
    // These HTML buttons are distinct from the canvas buttons.
    // They are now primarily for fallback or if you decide to keep some HTML menu parts.
    if (htmlPlayButton) {
        htmlPlayButton.addEventListener("click", () => {
            console.log("HTML Play button clicked (showing map selection)");
            showPanel(mapSelect); // This will show the HTML map selection, which is now less relevant
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

    if (htmlLoadoutButton) { // Added listener for loadout button
        htmlLoadoutButton.addEventListener("click", () => {
            console.log("HTML Loadout button clicked!");
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
                showPanel(controlsMenu); // Go back to settings after saving
            } else {
                console.warn("Username cannot be empty!");
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

    // --- Map Selection Logic (for HTML buttons - now less relevant) ---
    mapButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            username = localStorage.getItem("username");
            if (!username) {
                showPanel(usernamePrompt); // Prompt for username if not set
                return;
            }

            const mapName = btn.dataset.map;
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            console.log(`Player clicked HTML map button for map: ${mapName}, Username: ${username}, Details Enabled: ${currentDetailsEnabled}`);

            // This part is now handled by joinGame function
            // The HTML map selection buttons are largely deprecated by the canvas-based lobby system
        });
    });

    initializeMenuDisplay(); // Set initial display state for menu panels
}

// --- Main execution logic ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase menu database refs
    menuDbRefs = getMenuDbRefs();
    gamesRef = menuDbRefs.gamesRef;

    // Always initialize the menu UI if we are on index.html or the root path
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        console.log("Attempting to initialize Menu UI on index.html...");
        initMenuUI(); // Initialize the HTML-based menu
        setupMainMenu(); // Initialize the canvas-based main menu
        transitionToMenuState(MENU_STATE.MAIN); // Ensure main menu is shown initially
        console.log("Menu UI initialization process started.");
    } else {
        // This block handles cases where the page might be game.html or similar,
        // though the current setup aims for a single-page application.
        const gameWrapper = document.getElementById('game-container');
        if (gameWrapper) {
            createGameUI(gameWrapper);

            const username = localStorage.getItem("username") || "Guest";
            const urlParams = new URLSearchParams(window.location.search);
            const gameId = urlParams.get('gameId'); // Get gameId from URL
            const mapName = urlParams.get('map'); // Get mapName from URL

            if (gameId && mapName) {
                await initNetwork(username, gameId);
                startGame(username, mapName, localStorage.getItem("detailsEnabled") === "true");
            } else {
                console.warn("No gameId or mapName in URL. Returning to main menu.");
                disconnectAndReturnToMenu(); // Go back to menu if no game context
            }
        } else {
            console.error("game-container element not found!");
        }
    }
});

// Event listener for Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const chatInput = document.getElementById("chat-input");
        const isChatFocused = document.activeElement === chatInput;
        const isHTMLSettingsVisible = document.getElementById("controls-menu") && !document.getElementById("controls-menu").classList.contains("hidden");

        if (isChatFocused) {
            // If chat is focused, blur it
            chatInput.blur();
            e.preventDefault();
        } else if (isHTMLSettingsVisible) {
            // If HTML settings are open, go back to escape main menu
            document.getElementById("menu-overlay").style.display = 'none'; // Hide HTML settings
            document.getElementById("controls-menu").classList.add("hidden");
            canvas.style.display = 'block'; // Show canvas again
            transitionToMenuState(MENU_STATE.ESCAPE_MAIN);
            e.preventDefault();
        } else if (document.getElementById('game-container').style.display === 'block') {
            // If in game, toggle escape menu
            toggleEscapeMenu();
            e.preventDefault();
        } else if (currentMenuState === MENU_STATE.ESCAPE_MAIN) {
            // If in escape main menu, close it (resume game)
            toggleEscapeMenu(false);
            e.preventDefault();
        }
        // If in main menu or play menu, Escape does nothing (or you can add a different behavior)
    }
});

// Expose disconnectAndReturnToMenu globally for game.js to call on win
window.disconnectAndReturnToMenu = disconnectAndReturnToMenu;
