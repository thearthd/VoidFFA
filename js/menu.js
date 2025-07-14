// menu.js

/*
    _____,,;;;`;        ;';;;,,_____
,~(  )  , )~~\ |        |/~( ,  (  )~;
' / / --`--,            .--'-- \ \ `
  /  \    | '            ` |    /  \

horse power
*/

// --- All imports moved to the top ---
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createGameUI, initBulletHoles } from "./ui.js"; // Placeholder, actual ui.js content needed for full functionality
import { startGame, toggleSceneDetails, stopGameAnimationAndCleanup } from "./game.js"; // Added stopGameAnimationAndCleanup
import { initNetwork, localPlayerId } from "./network.js"; // Added localPlayerId
import { getMenuDbRefs, getDbRefs, getMapConfig } from "./firebase-config.js"; // Import getMenuDbRefs, getDbRefs, and getMapConfig

// Firebase v8 compat imports
import "https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js";
import "https://www.gstatic.com/firebasejs/8.10.0/firebase-database.js";

// --- Start of engine.js content ---

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
export function getWidth()  { return canvasWidth; }

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
        this.borderColor = null; // Added for border support
        this.borderWidth = 0;    // Added for border support
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
        this.textAlign = 'center'; // Default text alignment
        this.textBaseline = 'middle'; // Default text baseline
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

    /**
     * Sets the text alignment.
     * @param {string} align - 'left', 'center', or 'right'.
     */
    setTextAlign(align) {
        this.textAlign = align;
    }

    /**
     * Sets the text baseline.
     * @param {string} baseline - 'top', 'middle', 'bottom', etc.
     */
    setTextBaseline(baseline) {
        this.textBaseline = baseline;
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
let menuAnimationId = null; // To store the requestAnimationFrame ID for the menu loop
export function gameLoop() { // Exported for external control (e.g., stopping)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    // Sort and draw shapes by layer to ensure correct rendering order
    shapes.sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let shape of shapes) {
        shape.draw(ctx);
    }
    menuAnimationId = requestAnimationFrame(gameLoop);
}

// Start the game loop
menuAnimationId = requestAnimationFrame(gameLoop);

/**
 * Makes a shape clickable by associating it with an onClick callback.
 * @param {Shape} shape - The shape to make clickable.
 * @param {Function} onClick - The function to call when the shape is clicked.
 */
export function makeButton(shape, onClick) {
    clickableShapes.push({ shape, onClick });
}

// Event listener for mouse clicks on the canvas
canvas.addEventListener("click", function(event) {
    const rect = canvas.getBoundingClientRect();
    // Calculate scaling factors to convert CSS pixels to canvas pixels
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get click coordinates in canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top ) * scaleY;

    // Check if the click occurred within any clickable shape
    for (const entry of clickableShapes) {
        const s = entry.shape;

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
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;

    // Convert from CSS pixels into canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top ) * scaleY;

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
            isHovering = dx*dx + dy*dy <= s.getRadius()*s.getRadius();
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
    setClearColor: () => {} // Placeholder function
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
logo.setPosition(getWidth() / 2, getHeight()/32);
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

    // Ensure buttons are interactive regardless of `inMenu` for now, as menu states change
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

// Button Definitions using the reusable createAnimatedButton function
let playButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a",
    1920/6, 1080/6, // Original width and height
    0, getHeight()/4, // Position
    1920/6 - 25, 1080/8, // Hitbox dimensions (slightly smaller than image)
    () => { 
        console.log("Play button hit"); 
        playButtonHit(); // Call function to change menu state
    }
);

let settingsButton = createAnimatedButton(
    "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8",
    1920/8, 1080/8,
    0 + 15, getHeight()/4 + leftbuttonSpacing + playButton.image.y/8,
    1920/8, 1080/10,
    () => { console.log("Settings button hit"); showSettingsMenu(); } // Modified to show settings menu
);

let careerButton = createAnimatedButton(
    "https://codehs.com/uploads/afd818ac19ff0bbd919c766a1625071e",
    1920/8, 1080/8,
    0 + 15, getHeight()/4 + leftbuttonSpacing*2 + playButton.image.y/8,
    1920/8, 1080/10,
    () => { console.log("Career button hit"); }
);

let loadoutButton = createAnimatedButton(
    "https://codehs.com/uploads/765a0c87dc6d5d571ff25f139003227f",
    1920/8, 1080/8,
    0 + 15, getHeight()/4 + leftbuttonSpacing*3 + playButton.image.y/8,
    1920/8, 1080/10,
    () => { console.log("Loadout button hit"); }
);

// New: Game Creation button
let createGameButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Reusing play button image for now
    1920/8, 1080/8,
    getWidth() / 2 - (1920/8)/2, getHeight() / 2 + 100, // Centered below main buttons
    1920/8, 1080/10,
    () => { console.log("Create Game button hit"); showCreateGameMenu(); }
);

// Escape Menu Buttons
let escapePlayButton, escapeSettingsButton, escapeExitButton;
let escapeMenuOpen = false;
let currentEscapeMenuPage = 'main'; // 'main' or 'settings'

function createEscapeMenuButtons() {
    const buttonWidth = 200;
    const buttonHeight = 80;
    const startX = getWidth() / 2 - buttonWidth / 2;
    const startY = getHeight() / 2 - 150;
    const spacing = 100;

    escapePlayButton = createAnimatedButton(
        "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Play icon
        buttonWidth, buttonHeight,
        startX, startY,
        buttonWidth, buttonHeight,
        () => {
            console.log("Escape Play button hit");
            hideEscapeMenu();
            // Go back to the game lobby or main menu if not in game
            if (!window.isGameActive) { // Assuming a global flag for game active state
                playButtonHit();
            }
        }
    );

    escapeSettingsButton = createAnimatedButton(
        "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8", // Settings icon
        buttonWidth, buttonHeight,
        startX, startY + spacing,
        buttonWidth, buttonHeight,
        () => {
            console.log("Escape Settings button hit");
            showSettingsMenu(true); // true indicates coming from escape menu
        }
    );

    escapeExitButton = createAnimatedButton(
        "https://codehs.com/uploads/afd818ac19ff0bbd919c766a1625071e", // Career icon for exit
        buttonWidth, buttonHeight,
        startX, startY + spacing * 2,
        buttonWidth, buttonHeight,
        () => {
            console.log("Escape Exit button hit");
            exitGame();
        }
    );
}

function showEscapeMenu() {
    if (escapeMenuOpen) return; // Prevent opening multiple times
    escapeMenuOpen = true;
    currentEscapeMenuPage = 'main';
    removeAll();
    add(background); // Keep background
    add(escapePlayButton.image);
    add(escapeSettingsButton.image);
    add(escapeExitButton.image);
    add(escapePlayButton.hitbox);
    add(escapeSettingsButton.hitbox);
    add(escapeExitButton.hitbox);
}

function hideEscapeMenu() {
    if (!escapeMenuOpen) return;
    escapeMenuOpen = false;
    removeAll();
    // Restore the appropriate menu state (main menu or game lobby)
    if (window.isGameActive) {
        // If in game, simply hide the menu and resume game view
        document.getElementById("menuCanvas").style.display = 'none';
        document.getElementById("game-container").style.display = 'block';
        document.body.classList.add("game-active");
        document.getElementById("hud").style.display = "block";
        document.getElementById("crosshair").style.display = "block";
        // Re-enable pointer lock if it was lost
        document.body.requestPointerLock();
    } else {
        // If not in game (e.g., in lobby), return to lobby view
        menu(); // This will redraw the main menu or lobby
    }
}

function exitGame() {
    console.log("Exiting game...");
    if (window.isGameActive) {
        stopGameAnimationAndCleanup(); // Stop game loop and disconnect
    }
    // Ensure canvas is visible and game container is hidden
    document.getElementById("menuCanvas").style.display = 'block';
    document.getElementById("game-container").style.display = 'none';
    document.body.classList.remove("game-active");
    document.getElementById("hud").style.display = "none";
    document.getElementById("crosshair").style.display = "none";
    
    // Release pointer lock
    document.exitPointerLock();

    // Go back to main menu
    menu();
}

/**
 * Initializes the main menu by adding all primary menu elements to the canvas.
 */
function menu(){
    removeAll(); // Clear existing elements before drawing main menu
    add(logo);
    add(background);
    add(playButton.image);
    add(settingsButton.image);
    add(careerButton.image);
    add(loadoutButton.image);
    
    // Add hitboxes for click detection
    add(playButton.hitbox);
    add(settingsButton.hitbox);
    add(careerButton.hitbox);
    add(loadoutButton.hitbox);

    // Check for a winner from previous game and display
    checkAndDisplayWinner();
}

let winnerText = null;
let winnerListener = null; // To store the Firebase listener for winner

export function showWinnerOnMenu(winnerName) {
    // Stop any ongoing game animation and clean up game resources
    stopGameAnimationAndCleanup();

    // Ensure menu is visible and game elements are hidden
    document.getElementById("menuCanvas").style.display = 'block';
    document.getElementById("game-container").style.display = 'none';
    document.body.classList.remove("game-active");
    document.getElementById("hud").style.display = "none";
    document.getElementById("crosshair").style.display = "none";
    document.exitPointerLock(); // Release pointer lock

    // Clear existing menu elements and draw the main menu
    menu(); 

    // Display winner text
    if (winnerText) remove(winnerText); // Remove old text if exists
    winnerText = new Text(`${winnerName} won the game!`, '48pt Arial');
    winnerText.setPosition(getWidth() / 2, getHeight() / 2 - 200);
    winnerText.setColor('yellow');
    winnerText.setLayer(20);
    add(winnerText);
    console.log(`Displaying winner: ${winnerName}`);

    // Clear winner text after 10 seconds
    setTimeout(() => {
        if (winnerText) {
            remove(winnerText);
            winnerText = null;
        }
    }, 10000);
}


async function checkAndDisplayWinner() {
    const menuDbRefs = getMenuDbRefs();
    // Assuming we only check 'game1' for now, or the last played game.
    // In a multi-game system, this might need to be more dynamic.
    const winnerRef = menuDbRefs.gamesRef.child('game1/winner'); 

    // Remove previous listener if it exists
    if (winnerListener) {
        winnerRef.off('value', winnerListener);
        winnerListener = null;
    }

    winnerListener = winnerRef.on('value', (snapshot) => {
        const winnerData = snapshot.val();
        if (winnerData && winnerData.winnerName) {
            if (winnerText) remove(winnerText); // Remove old text if exists
            winnerText = new Text(`${winnerData.winnerName} won the game!`, '48pt Arial');
            winnerText.setPosition(getWidth() / 2, getHeight() / 2 - 200);
            winnerText.setColor('yellow');
            winnerText.setLayer(20);
            add(winnerText);
            console.log(`Displaying winner: ${winnerData.winnerName}`);

            // Clear winner after 10 seconds
            setTimeout(() => {
                if (winnerText) {
                    remove(winnerText);
                    winnerText = null;
                }
                winnerRef.remove(); // Clear winner from Firebase too
            }, 10000);
        } else {
            if (winnerText) {
                remove(winnerText);
                winnerText = null;
            }
        }
    });
}


/**
 * Function called when the "Play" button (canvas-drawn) is clicked.
 * Clears the current menu and displays the canvas-based map selection options.
 */
function playButtonHit(){
    removeAll(); // Remove all existing shapes from the canvas
    add(logo); // Re-add logo
    add(background); // Re-add background
    displayGameLobby(); // Display available games
    add(createGameButton.image); // Add the create game button
    add(createGameButton.hitbox);
}

const MAX_GAMES = 2;
const MAX_PLAYERS_PER_GAME = 10;
const GAME_DURATION_SECONDS = 10 * 60; // 10 minutes in seconds
const KILL_LIMIT = 50;

let gameLobbyListener = null; // To store the Firebase listener for game lobby

async function displayGameLobby() {
    removeAll();
    add(logo);
    add(background);
    add(createGameButton.image); // Add the create game button
    add(createGameButton.hitbox);

    const menuDbRefs = getMenuDbRefs();
    const gamesRef = menuDbRefs.gamesRef;

    // Remove previous listener if it exists
    if (gameLobbyListener) {
        gamesRef.off('value', gameLobbyListener);
        gameLobbyListener = null;
    }

    gameLobbyListener = gamesRef.on('value', (snapshot) => {
        const games = snapshot.val();
        const gameList = [];
        for (const gameId in games) {
            // Only add games that are not "ended" or have players
            if (games[gameId].settings && (games[gameId].settings.status !== "ended" || (games[gameId].players && Object.keys(games[gameId].players).length > 0))) {
                gameList.push({ id: gameId, ...games[gameId].settings });
            }
        }

        // Clear existing game boxes and text before redrawing
        // Filter out existing game boxes and text, but keep logo, background, and create game button
        shapes.filter(s => s.isGameBox || s.isGameText || s.isGameBoxHitbox).forEach(s => remove(s));
        clickableShapes.filter(s => s.isGameBoxHitbox).forEach(s => {
            const index = clickableShapes.indexOf(s);
            if (index > -1) clickableShapes.splice(index, 1);
        });

        if (gameList.length === 0) {
            let noGamesText = new Text("No games available. Create one!", '30pt Arial');
            noGamesText.setPosition(getWidth() / 2, getHeight() / 2);
            noGamesText.setColor('white');
            noGamesText.setLayer(10);
            add(noGamesText);
        } else {
            let startY = getHeight() / 4;
            const boxWidth = 600;
            const boxHeight = 150;
            const padding = 20;

            gameList.forEach((game, index) => {
                const gameBox = new Rectangle(boxWidth, boxHeight);
                gameBox.setPosition(getWidth() / 2 - boxWidth / 2, startY + index * (boxHeight + padding));
                gameBox.setColor('#333333');
                gameBox.setBorderColor('#555555');
                gameBox.setBorderWidth(5);
                gameBox.setLayer(5);
                gameBox.isGameBox = true; // Custom property for filtering
                add(gameBox);

                const mapText = new Text(`Map: ${game.mapName}`, '24pt Arial');
                mapText.setPosition(gameBox.getX() + boxWidth / 2, gameBox.getY() + 30);
                mapText.setColor('white');
                mapText.setLayer(6);
                mapText.isGameText = true;
                add(mapText);

                const playerCount = game.playerCount || 0;
                const playersText = new Text(`Players: ${playerCount}/${MAX_PLAYERS_PER_GAME}`, '20pt Arial');
                playersText.setPosition(gameBox.getX() + boxWidth / 2, gameBox.getY() + 70);
                playersText.setColor('white');
                playersText.setLayer(6);
                playersText.isGameText = true;
                add(playersText);

                const gamemodeText = new Text(`Mode: ${game.gameMode}`, '20pt Arial');
                gamemodeText.setPosition(gameBox.getX() + boxWidth / 2, gameBox.getY() + 110);
                gamemodeText.setColor('white');
                gamemodeText.setLayer(6);
                gamemodeText.isGameText = true;
                add(gamemodeText);

                // Make the game box clickable
                const gameBoxHitbox = new Rectangle(boxWidth, boxHeight);
                gameBoxHitbox.setPosition(gameBox.getX(), gameBox.getY());
                gameBoxHitbox.setColor("rgba(255, 0, 0, 0.0)"); // Transparent hitbox
                gameBoxHitbox.setLayer(15);
                gameBoxHitbox.isGameBoxHitbox = true; // Custom property for filtering
                makeButton(gameBoxHitbox, () => joinGame(game.id)); // Pass only game.id
                add(gameBoxHitbox);
            });
        }
    });
}

async function showCreateGameMenu() {
    removeAll();
    add(logo);
    add(background);

    let menuDbRefs = getMenuDbRefs();
    let gamesRef = menuDbRefs.gamesRef;

    const snapshot = await gamesRef.once('value');
    const currentGames = snapshot.val();
    const numGames = currentGames ? Object.keys(currentGames).length : 0;

    if (numGames >= MAX_GAMES) {
        let limitText = new Text("Game limit reached (2 games max).", '30pt Arial');
        limitText.setPosition(getWidth() / 2, getHeight() / 2);
        limitText.setColor('red');
        limitText.setLayer(10);
        add(limitText);

        let backButton = createAnimatedButton(
            "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8", // Using settings icon for back
            100, 100,
            getWidth() / 2 - 50, getHeight() / 2 + 100,
            100, 100,
            () => displayGameLobby()
        );
        add(backButton.image);
        add(backButton.hitbox);
        return;
    }

    let createGameTitle = new Text("Create New Game", '40pt Arial');
    createGameTitle.setPosition(getWidth() / 2, getHeight() / 4);
    createGameTitle.setColor('white');
    createGameTitle.setLayer(10);
    add(createGameTitle);

    // Map selection
    let selectedMapName = null; // Store mapName directly

    function selectMapForCreation(mapName) {
        selectedMapName = mapName;
        console.log(`Selected map: ${mapName}`);
        // Visual feedback for selected map (e.g., changing border/color)
        // For simplicity, we'll just log for now.
    }

    // Buttons for SigmaCity and CrocodilosConstruction
    let mapSigmaCityButton = createAnimatedButton(
        "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Play button icon
        1920/8, 1080/8,
        getWidth() / 2 - 200, getHeight() / 2,
        1920/8, 1080/10,
        () => selectMapForCreation("SigmaCity")
    );
    add(mapSigmaCityButton.image);
    add(mapSigmaCityButton.hitbox);
    let mapSigmaCityText = new Text("SigmaCity", '24pt Arial');
    mapSigmaCityText.setPosition(mapSigmaCityButton.image.getX() + mapSigmaCityButton.image.getWidth() / 2, mapSigmaCityButton.image.getY() + mapSigmaCityButton.image.getHeight() + 20);
    mapSigmaCityText.setColor('white');
    mapSigmaCityText.setLayer(10);
    add(mapSigmaCityText);

    let mapCrocodilosButton = createAnimatedButton(
        "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Play button icon
        1920/8, 1080/8,
        getWidth() / 2 + 200, getHeight() / 2,
        1920/8, 1080/10,
        () => selectMapForCreation("CrocodilosConstruction")
    );
    add(mapCrocodilosButton.image);
    add(mapCrocodilosButton.hitbox);
    let mapCrocodilosText = new Text("Crocodilos Construction", '24pt Arial');
    mapCrocodilosText.setPosition(mapCrocodilosButton.image.getX() + mapCrocodilosButton.image.getWidth() / 2, mapCrocodilosButton.image.getY() + mapCrocodilosButton.image.getHeight() + 20);
    mapCrocodilosText.setColor('white');
    mapCrocodilosText.setLayer(10);
    add(mapCrocodilosText);

    // Gamemode selection (FFA enabled, TDM greyed out)
    let ffaButton = createAnimatedButton(
        "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Play button icon
        1920/10, 1080/10,
        getWidth() / 2 - 150, getHeight() / 2 + 250,
        1920/10, 1080/12,
        () => { /* FFA selected, no action needed yet */ }
    );
    add(ffaButton.image);
    add(ffaButton.hitbox);
    let ffaText = new Text("FFA", '24pt Arial');
    ffaText.setPosition(ffaButton.image.getX() + ffaButton.image.getWidth() / 2, ffaButton.image.getY() + ffaButton.image.getHeight() + 20);
    ffaText.setColor('white');
    ffaText.setLayer(10);
    add(ffaText);

    let tdmButton = createAnimatedButton(
        "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8", // Settings icon for greyed out
        1920/10, 1080/10,
        getWidth() / 2 + 150, getHeight() / 2 + 250,
        1920/10, 1080/12,
        () => { /* TDM is greyed out, do nothing */ }
    );
    tdmButton.image.setOpacity(0.5); // Grey out
    tdmButton.hitbox.onHover = null; // Disable hover
    tdmButton.hitbox.onUnhover = null; // Disable unhover
    add(tdmButton.image);
    add(tdmButton.hitbox);
    let tdmText = new Text("TDM (Coming Soon)", '24pt Arial');
    tdmText.setPosition(tdmButton.image.getX() + tdmButton.image.getWidth() / 2, tdmButton.image.getY() + tdmButton.image.getHeight() + 20);
    tdmText.setColor('grey');
    tdmText.setLayer(10);
    add(tdmText);

    let createButton = createAnimatedButton(
        "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a", // Play button icon
        200, 100,
        getWidth() / 2 - 100, getHeight() - 200,
        200, 100,
        async () => {
            if (selectedMapName) {
                // Find the next available game ID (game1 or game2)
                let newGameId = null;
                if (!currentGames || !currentGames.game1) {
                    newGameId = "game1";
                } else if (!currentGames.game2) {
                    newGameId = "game2";
                }

                if (newGameId) {
                    await createNewGame(newGameId, selectedMapName, "FFA");
                    displayGameLobby(); // Go back to lobby after creation
                } else {
                    console.warn("No available game slots (game1 or game2) to create a new game.");
                    let warningText = new Text("No available game slots!", '30pt Arial');
                    warningText.setPosition(getWidth() / 2, getHeight() - 300);
                    warningText.setColor('red');
                    warningText.setLayer(20);
                    add(warningText);
                    setTimeout(() => remove(warningText), 3000);
                }
            } else {
                console.warn("Please select a map before creating a game.");
                // Add a temporary text message to the screen
                let warningText = new Text("Please select a map!", '30pt Arial');
                warningText.setPosition(getWidth() / 2, getHeight() - 300);
                warningText.setColor('red');
                warningText.setLayer(20);
                add(warningText);
                setTimeout(() => remove(warningText), 3000);
            }
        }
    );
    add(createButton.image);
    add(createButton.hitbox);
}

async function createNewGame(gameId, mapName, gameMode) {
    let menuDbRefs = getMenuDbRefs();
    let gamesRef = menuDbRefs.gamesRef;

    const gameSettings = {
        mapName: mapName,
        playerCount: 0, // Will be updated when players join
        gameMode: gameMode,
        timer: GAME_DURATION_SECONDS, // 10 minutes in seconds
        killLimit: KILL_LIMIT,
        status: "lobby", // "lobby", "active", "ended"
        createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    await gamesRef.child(gameId).set({
        settings: gameSettings,
        // Other game-specific data will be under this gameId path
        players: {},
        chat: {},
        kills: {},
        tracers: {},
        sounds: {},
        mapState: { bullets: {} }
    }).then(() => {
        console.log(`Game ${gameId} created with settings:`, gameSettings);
    }).catch(error => {
        console.error("Error creating new game:", error);
    });
}


async function joinGame(gameId) {
    removeAll(); // Clear menu elements
    if (gameLobbyListener) {
        getMenuDbRefs().gamesRef.off('value', gameLobbyListener); // Detach listener
    }

    const gameDbRefs = getDbRefs(gameId);
    const gameSettingsSnap = await gameDbRefs.gameSettingsRef.once('value');
    const gameSettings = gameSettingsSnap.val();

    if (!gameSettings) {
        console.error(`Game settings for ${gameId} not found.`);
        displayGameLobby(); // Go back to lobby
        return;
    }

    const mapName = gameSettings.mapName;
    const currentPlayersSnap = await gameDbRefs.playersRef.once('value');
    const currentPlayerCount = currentPlayersSnap.numChildren();

    if (currentPlayerCount >= MAX_PLAYERS_PER_GAME) {
        console.warn(`Game ${gameId} is full.`);
        let fullText = new Text("Game is full!", '30pt Arial');
        fullText.setPosition(getWidth() / 2, getHeight() / 2);
        fullText.setColor('red');
        fullText.setLayer(20);
        add(fullText);
        setTimeout(() => remove(fullText), 3000);
        displayGameLobby(); // Go back to lobby
        return;
    }

    // Update player count in game settings
    await gameDbRefs.gameSettingsRef.update({ playerCount: currentPlayerCount + 1 });

    // Hide the canvas and show game container
    canvas.style.display = 'none';
    document.getElementById('game-container').style.display = 'block';

    // Start the game with the retrieved gameId and mapName
    const username = localStorage.getItem("username") || "Guest";
    const detailsEnabled = localStorage.getItem("detailsEnabled") === "true";
    console.log(`Joining game ${gameId} on map: ${mapName}, Username: ${username}, Details Enabled: ${detailsEnabled}.`);
    startGame(username, gameId, detailsEnabled); // Pass gameId instead of mapName
}

function showSettingsMenu(fromEscapeMenu = false) {
    removeAll();
    add(logo);
    add(background);

    let settingsTitle = new Text("Settings", '40pt Arial');
    settingsTitle.setPosition(getWidth() / 2, getHeight() / 4);
    settingsTitle.setColor('white');
    settingsTitle.setLayer(10);
    add(settingsTitle);

    // Placeholder for actual settings UI elements
    let placeholderText = new Text("Settings options will go here...", '24pt Arial');
    placeholderText.setPosition(getWidth() / 2, getHeight() / 2);
    placeholderText.setColor('lightgrey');
    placeholderText.setLayer(10);
    add(placeholderText);

    let backButton = createAnimatedButton(
        "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8", // Using settings icon for back
        100, 100,
        getWidth() / 2 - 50, getHeight() - 200,
        100, 100,
        () => {
            if (fromEscapeMenu) {
                showEscapeMenu(); // Go back to the main escape menu
            } else {
                menu(); // Go back to the main menu
            }
        }
    );
    add(backButton.image);
    add(backButton.hitbox);
}

// --- Main execution logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Always initialize the menu UI if we are on index.html or the root path
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        console.log("Attempting to initialize Menu UI on index.html...");
        // initMenuUI(); // This was for HTML-based menu, now handled by canvas
        menu(); // Initialize the canvas-based main menu
        createEscapeMenuButtons(); // Initialize escape menu buttons once
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
            if (gameId) {
                // Potentially call startGame here if game.html is directly loaded with parameters
                // This scenario is less likely with the single-page app approach.
                // You'd need to fetch mapName from Firebase using gameId first.
                // For now, assume direct game load is not the primary flow.
            }
        } else {
            console.error("game-container element not found!");
        }
    }
});

// Event listener for Escape key
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (escapeMenuOpen) {
            if (currentEscapeMenuPage === 'settings') {
                showEscapeMenu(); // Go back to main escape menu from settings
            } else {
                hideEscapeMenu(); // Close the escape menu
            }
        } else {
            // Only show escape menu if game is active
            if (document.body.classList.contains("game-active")) {
                showEscapeMenu(); // Open the escape menu
                document.exitPointerLock(); // Release pointer lock when menu opens
            }
        }
    }
});

