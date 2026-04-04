## Quick Sart

1. Install dependencies
```bash
npm i -D typescript ts-node @types/node
```
2. Initialize Typescript config
```bash
npx tsc --init
```
3. Update [package.json](package.json)
```json
{
  "name": "tools",
  "version": "1.0.0",
  "description": "",
  "scripts": {
    "build": "tsc",
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "devDependencies": {
    "@types/node": "^22.x",
    "ts-node": "^10.x",
    "typescript": "^5.x"
  }
}
```
4. Update [tsconfig.json](tsconfig.json)
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```