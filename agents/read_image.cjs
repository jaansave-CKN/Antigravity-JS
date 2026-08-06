const Tesseract = require('tesseract.js');

const imagePath = 'C:/Users/Usuario/.gemini/antigravity/brain/47b84cbd-e7e1-415a-8c6a-e22ba6466ddb/media__1777147317039.png';

Tesseract.recognize(
  imagePath,
  'spa',
  { logger: m => console.log(m.status, m.progress) }
).then(({ data: { text } }) => {
  console.log('--- TEXT EXTRACTED ---');
  console.log(text);
}).catch(err => {
  console.error('Error extracting text:', err);
});
