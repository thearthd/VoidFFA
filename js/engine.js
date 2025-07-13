/*

   _____,,;;;`;       ;';;;,,_____
,~(  )  , )~~\|       |/~~( ,  (  )~;
' / / --`--,             .--'-- \ \ `
 /  \    | '             ` |    /  \


horse power

*/


const preload = src => {
    const img = new Image();
    img.src = src;
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const canvasWidth = canvas.width;
const canvasHeight = canvas.height;

const clickableShapes = [];


function getWidth()  { return canvasWidth; }
function getHeight() { return canvasHeight; }

const HOLD_RELEASE_GRACE_PERCENT = 0.80;

// List of shapes to draw
const shapes = [];

// Add shape to drawing list
function add(shape) {
    shapes.push(shape);
}
// Remove shape from drawing list
function remove(shape) {
    const index = shapes.indexOf(shape);
    if (index > -1) {
        shapes.splice(index, 1);
    }
}
// Remove all shapes
function removeAll() {
    shapes.length = 0;
}



// Shape base class
class Shape {
    constructor() {
        this.layer = 0;
        this.opacity = 1.0;
        this.hovered = false;
        this.onHover = null;   // function to call when hovered
        this.onUnhover = null; // function to call when unhovered
    }

    setOpacity(o) { this.opacity = o; }
    setLayer(l) { this.layer = l; }
}


// Circle shape
class Circle extends Shape {
    constructor(radius) {
        super();
        this.radius = radius;
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.borderColor = null;
        this.borderWidth = 0;
    }
    setRadius(r) {
    this.radius = r;
    }
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }
    setColor(color) {
        this.color = color;
    }
    setBorderColor(color) {
        this.borderColor = color;
    }
    setBorderWidth(w) {
        this.borderWidth = w;
    }
    getX() { return this.x; }
    getY() { return this.y; }
    getRadius() { return this.radius; }
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }
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

// Rectangle shape
class Rectangle extends Shape {
    constructor(width, height) {
        super();
        this.width = width;
        this.height = height;
        this.x = 0;
        this.y = 0;
        this.color = 'black';
    }
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }
    setColor(color) {
        this.color = color;
    }
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }
    getX() { return this.x; }
    getY() { return this.y; }
    getWidth() { return this.width; }
    getHeight() { return this.height; }
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.restore();
    }
}

// Text shape
class Text {
    constructor(text, font) {
        this.text = text;
        this.font = font || '16pt Tahoma';
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.layer = 0;
        this.opacity = 1.0;
    }
    move(dx, dy) {
    this.x += dx;
    this.y += dy;
    }
    setOpacity(o) {
    this.opacity = o;
    }

    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }
    setColor(color) {
        this.color = color;
    }
    setText(text) {
        this.text = text;
    }
    getX() { return this.x; }
    getY() { return this.y; }
    setLayer(l) { this.layer = l; }
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

class ImageShape extends Shape {
    constructor(src, onLoadCallback = null) {
        super();
        this.image = new Image();
        this.image.src = src;
        this.image.onload = () => {
            this.loaded = true;
            if (onLoadCallback) onLoadCallback(); // 💡 trigger once it's ready
        };
        this.loaded = false;

        this.x = 0;
        this.y = 0;
        this.width = 100;
        this.height = 100;
    }

    setSize(width, height) {
        this.width = width;
        this.height = height;
    }
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    draw(ctx) {
        if (!this.loaded) return; // 🛑 Skip drawing until it's ready
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.drawImage(this.image, this.x, this.y, this.width, this.height);       
        ctx.restore();
    }
}


function gameLoop() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // sort and draw shapes by layer
    shapes.sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let shape of shapes) {
        shape.draw(ctx);
    }
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);


function makeButton(shape, onClick) {
    clickableShapes.push({ shape, onClick });
}

canvas.addEventListener("click", function(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    for (const entry of clickableShapes) {
        const s = entry.shape;

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            if (inX && inY) {
                entry.onClick();
                break;
            }
        }
        if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            if (Math.sqrt(dx * dx + dy * dy) <= s.getRadius()) {
                entry.onClick();
                break;
            }
        }
        if (s instanceof ImageShape) {
            if (s instanceof ImageShape) {
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            if (inX && inY) {
                entry.onClick();
                break;
            }
        }

            // if (inX && inY - 10) {
            //     entry.onClick();
            //     break;
            // }
        }
    }
});


canvas.addEventListener("mousemove", function(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let hoveringAny = false; // <- Correct variable for all shapes

    for (const entry of clickableShapes) {
        const s = entry.shape;
        let isHovering = false;

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            isHovering = inX && inY;
        }

        if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            isHovering = Math.sqrt(dx * dx + dy * dy) <= s.getRadius();
        }

        if (s instanceof ImageShape) {
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            isHovering = inX && inY;
        }

        // Store if any are hovered for cursor control
        if (isHovering) hoveringAny = true;

        // Handle hover state change
        if (isHovering && !s.hovered) {
            s.hovered = true;
            if (s.onHover) s.onHover();
        } else if (!isHovering && s.hovered) {
            s.hovered = false;
            if (s.onUnhover) s.onUnhover();
        }
    }

    canvas.style.cursor = hoveringAny ? "pointer" : "default";
});



function showGifBG(src) {
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

function removeGifBG() {
    const gif = document.getElementById("animatedBG");
    if (gif) gif.remove();
}
