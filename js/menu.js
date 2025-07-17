// menu.js

/*
     _____,,;;;`;         ;';;;,,_____
,~(  )  , )~~\ |         |/~( ,  (  )~;
' / / --`--,             .--'-- \ \ `
  /  \    | '           ` |    /  \

horse power
*/

// --- All imports moved to the top ---
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createGameUI, initBulletHoles } from "./ui.js"; // Placeholder, actual ui.js content needed for full functionality
import { startGame, toggleSceneDetails } from "./game.js"; // Placeholder, actual game.js content needed for full functionality
import { initNetwork } from "./network.js"; // Placeholder, actual network.js content needed for full functionality

// Make sure you have this script tag in your HTML <head> or before your menu.js script:
// <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

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
        shape.draw(ctx);
    }
    requestAnimationFrame(gameLoop);
}

// Start the game loop
requestAnimationFrame(gameLoop);

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

    if (inMenu) { // Only make buttons interactive if we are in the menu state
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
    }
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


let createGameButton = createAnimatedButton(
    "https://codehs.com/uploads/31eb8424a7b74d1266c4e1e210845583",
    1920/6, 1080/6, // Original width and height
    0, getHeight()/4, // Position
    1920/6 - 25, 1080/8, // Hitbox dimensions (slightly smaller than image)
    () => { 
        console.log("createGameButton hit"); 
        createGameButtonHit(); // Call function to change menu state
    }
);

let settingsButton = createAnimatedButton(
    "https://codehs.com/uploads/b3e2a8dfe6107e2af96ce74f9799b0f8",
    1920/8, 1080/8,
    0 + 15, getHeight()/4 + leftbuttonSpacing + playButton.image.y/8,
    1920/8, 1080/10,
    () => { console.log("Settings button hit"); }
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

// These two buttons are for a sub-menu after "Play" is hit
let crocoPlayButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a",
    1920/6, 1080/6, // Original width and height
    getWidth()/1.5, getHeight()-200, // Position towards the right bottom
    1920/6 - 25, 1080/8, // Hitbox dimensions
    () => { 
        console.log("crocoPlayButton clicked, starting CrocodilosConstruction map.");
        const username = localStorage.getItem("username") || "Guest";
        const detailsEnabled = localStorage.getItem("detailsEnabled") === "true";
        const menuOverlay = document.getElementById("menu-overlay");
        const gameWrapper = document.getElementById('game-container');

        if (menuOverlay) {
            menuOverlay.classList.add("hidden");
        }
        // Hide the canvas itself if it's the main menu display
        if (canvas) {
            canvas.style.display = 'none';
        }
        if (gameWrapper) {
            let ffaEnabled = true;
            menuSong.pause();
            gameWrapper.style.display = 'block'; // Or 'flex', depending on its CSS
            createGameUI(gameWrapper);
            initNetwork(username, "CrocodilosConstruction");
            startGame(username, "CrocodilosConstruction", detailsEnabled, ffaEnabled);
            console.log(`Game started for map: CrocodilosConstruction, Username: ${username}, Details Enabled: ${detailsEnabled}.`);
        } else {
            console.error("game-container element not found! Cannot start game.");
        }
    }
);

let sigmaPlayButton = createAnimatedButton(
    "https://codehs.com/uploads/990902d0fe3f334a496c84d9d2b6f00a",
    1920/6, 1080/6, // Original width and height
    getWidth()/3, getHeight()-200, // Position towards the left bottom
    1920/6 - 25, 1080/8, // Hitbox dimensions
    () => { 
        console.log("sigmaPlayButton clicked, starting SigmaCity map.");
        const username = localStorage.getItem("username") || "Guest";
        const detailsEnabled = localStorage.getItem("detailsEnabled") === "true";
        const menuOverlay = document.getElementById("menu-overlay");
        const gameWrapper = document.getElementById('game-container');

        if (menuOverlay) {
            menuOverlay.classList.add("hidden");
        }
        // Hide the canvas itself if it's the main menu display
        if (canvas) {
            canvas.style.display = 'none';
        }
        if (gameWrapper) {
            let ffaEnabled = true;
            menuSong.pause();
            gameWrapper.style.display = 'block'; // Or 'flex', depending on its CSS
            createGameUI(gameWrapper);
            initNetwork(username, "SigmaCity");
            startGame(username, "SigmaCity", detailsEnabled, ffaEnabled);
            console.log(`Game started for map: SigmaCity, Username: ${username}, Details Enabled: ${detailsEnabled}.`);
        } else {
            console.error("game-container element not found! Cannot start game.");
        }
    }
);

/**
 * Initializes the main menu by adding all primary menu elements to the canvas.
 */
function menu(){
    add(logo);
    add(playButton.image);
    add(settingsButton.image);
    add(careerButton.image);
    add(loadoutButton.image);
    
    // Add hitboxes for click detection
    add(playButton.hitbox);
    add(settingsButton.hitbox);
    add(careerButton.hitbox);
    add(loadoutButton.hitbox);
}

// Call the menu function to set up the initial menu display
menu();

/**
 * Function called when the "Play" button (canvas-drawn) is clicked.
 * Clears the current menu and displays the canvas-based map selection options.
 */
function playButtonHit(){
    removeAll(); // Remove all existing shapes from the canvas
    add(logo); // Re-add logo
    add(crocoPlayButton.image); // Add new play options
    add(sigmaPlayButton.image);
    add(createGameButton.image);

add(createGameButton.hitbox);

     makeButton(createGameButton.hitbox, createGameButton.hitbox.onClick);
     
    makeButton(crocoPlayButton.hitbox, crocoPlayButton.hitbox.onClick);
    makeButton(sigmaPlayButton.hitbox, sigmaPlayButton.hitbox.onClick);
}

function createGameButtonHit(){
    removeAll(); // Remove all existing shapes from the canvas
    add(logo); // Re-add logo
    // Ensure their hitboxes are also added to the clickableShapes array for interaction
    // (This is handled by createAnimatedButton, but explicitly adding them here
    // for clarity if they were removed by removeAll)

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
    // NOTE: If you're going fully canvas-driven for main menu, these HTML buttons
    // should ideally be removed or hidden permanently.
    const htmlPlayButton = document.getElementById("play-button");
    const htmlSettingsButton = document.getElementById("settings-button");
    const htmlCareerButton = document.getElementById("career-button");

    const saveUsernameBtn = document.getElementById("save-username-btn");
    const usernameInput = document.getElementById("username-input");

    const sensitivityRange = document.getElementById("sensitivity-range");
    const sensitivityInput = document.getElementById("sensitivity-input");
    const toggleDetailsBtn = document.getElementById("toggle-details-btn");

    const mapButtons = document.querySelectorAll(".map-btn"); // HTML map selection buttons

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
        // If username exists, hide prompt and show canvas menu
        if (username && username.trim().length > 0) {
            showPanel(null); // Hide all HTML panels
            menu(); // Show canvas-drawn main menu
            document.getElementById("game-logo").classList.add("hidden"); // Hide the HTML game logo
            // Do not hide the canvas-drawn logo here, it's part of the `menu()` function
            // to be drawn. The `logo.setOpacity(0)` or `remove(logo)` will be used later.
                const gameLoogo = document.getElementById('menu-overlay');
                // Remove the canvas-drawn logo immediately after username is saved
                gameLoogo.style.display = 'none';
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
                
                // Hide the HTML username prompt
                showPanel(null); 
                
                // Show the canvas and draw the main menu
                canvas.style.display = 'block';
                menu(); 
                
                // Hide the HTML game logo
                document.getElementById("game-logo").classList.add("hidden");
                const gameLoogo = document.getElementById('game-logo');
                // Remove the canvas-drawn logo immediately after username is saved
                gameLoogo.style.display = 'none';
                
                // Potentially show a different HTML panel if desired, e.g., the main HTML menu
                // For now, it just transitions to the canvas menu.
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

    // --- Map Selection Logic (for HTML buttons) ---
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
                initNetwork(username, mapName); // Initialize network for multiplayer
                startGame(username, mapName, localStorage.getItem("detailsEnabled") === "true", ffaEnabled); // Start the game
                
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
                    // Optional: If you want to reset the game or go back to menu here,
                    // you can add logic. For now, it will just close the alert
                    // and show the menu as per the normal flow.
                    console.log("SweetAlert: User confirmed, proceeding to menu.");
                    // You might want to explicitly show your menu here if it's not
                    // automatically shown by initMenuUI:
                    // document.getElementById("menu-overlay").style.display = "flex";
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
        menu(); // Initialize the canvas-based menu
        console.log("Menu UI initialization process started.");
    } else {
        // This block handles cases where the page might be game.html or similar,
        // though the current setup aims for a single-page application.
        const gameWrapper = document.getElementById('game-container');
        if (gameWrapper) {
            createGameUI(gameWrapper);

            const username = localStorage.getItem("username") || "Guest";
            const urlParams = new URLSearchParams(window.location.search);
            const mapName = urlParams.get('map');
            // Potentially call startGame here if game.html is directly loaded with parameters
        } else {
            console.error("game-container element not found!");
        }
    }
});
