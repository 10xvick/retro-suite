import { writeFileSync } from 'fs';

async function main() {
  try {
    const res = await fetch('http://localhost:9222/json');
    const json = await res.json();
    console.log('Active Chrome tabs:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Error fetching Chrome tabs:', err);
  }
}

main();
