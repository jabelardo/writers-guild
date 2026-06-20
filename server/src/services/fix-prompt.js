const fs = require('fs');
const content = fs.readFileSync('default-presets.js', 'utf8');

// The exact old text to find
const oldText = 'Only return the rewritten text by itself in your response.\\n\\nText to rewrite:';
// The new text with image preservation instruction (using simpler syntax)
const newText = 'IMPORTANT: Preserve any images like "[img]" exactly as they appear. Do not remove images.\\n\\nOnly return the rewritten text by itself in your response.\\n\\nText to rewrite:';

const newContent = content.replace(oldText, newText);
fs.writeFileSync('default-presets.js', newContent);

console.log('Fixed successfully');
