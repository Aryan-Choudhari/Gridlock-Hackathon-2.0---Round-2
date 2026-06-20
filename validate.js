const fs = require('fs');
const html = fs.readFileSync('presentation.html', 'utf8');
const slides = html.match(/class="slide/g);
console.log("Total slides found:", slides.length);
