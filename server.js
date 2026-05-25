const express = require('express');
const path = require('path');
const { fileURLToPath } = require('url');
const cors = require('cors');
const app = express();

const corsOptions = {
  origin: 'https://antigravity-js.onrender.com',
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
