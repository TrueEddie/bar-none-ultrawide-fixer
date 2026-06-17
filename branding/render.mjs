import sharp from 'sharp';
await sharp('branding/bar-none.svg', { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile('branding/bar-none.png');
const meta = await sharp('branding/bar-none.png').metadata();
console.log(`PNG written: ${meta.width}x${meta.height}, ${meta.channels} channels, alpha=${meta.hasAlpha}`);
