// Run this in your browser console to generate a basic icon
const canvas = document.createElement('canvas');
canvas.width = 128;
canvas.height = 128;
const ctx = canvas.getContext('2d');

// Draw a simple icon
ctx.fillStyle = '#4a90e2';
ctx.beginPath();
ctx.arc(64, 64, 60, 0, Math.PI * 2);
ctx.fill();

ctx.fillStyle = 'white';
ctx.font = 'bold 80px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('H', 64, 64);

// Download the icon
const link = document.createElement('a');
link.download = 'hamzanibot.png';
link.href = canvas.toDataURL('image/png');
link.click(); 