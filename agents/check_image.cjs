const sharp = require('sharp');
const imagePath = 'C:/Users/Usuario/.gemini/antigravity/brain/47b84cbd-e7e1-415a-8c6a-e22ba6466ddb/media__1777147317039.png';

sharp(imagePath).metadata().then(metadata => {
    console.log(`Format: ${metadata.format}`);
    console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`Space: ${metadata.space}`);
    console.log(`Channels: ${metadata.channels}`);
}).catch(err => {
    console.error('Error:', err);
});
