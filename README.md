# MeshMend AI 🛠️🤖

**MeshMend AI** is a desktop IDE built for automotive crash and safety engineers. It acts as an autonomous AI assistant to find, diagnose, and auto-fix finite element (FE) mesh quality issues relative to CAD models.

Meshes generated from CAD (e.g. in ANSA 2025) routinely exhibit quality defects—inverted elements, high-aspect-ratio triangles, free edges, non-manifold geometry, poor Jacobian/warpage scores, and nodes misaligned from the source CAD surfaces. MeshMend AI automates this manual cleanup process, saving engineers days of work per vehicle sub-assembly.

## ✨ Features

- **Multi-Format Support**: Reads popular solver formats like Nastran (`.bdf`), Abaqus (`.inp`), and ANSYS (`.cdb`).
- **CAD Geometry Conformance**: Imports `.step` files using an embedded `opencascade.js` WebAssembly kernel to perform true 3D spatial deviation checks against the exact parametric surfaces.
- **Intrinsic Mesh Diagnostics**: Built-in topological and quality metrics (Aspect Ratio, Jacobian, Skewness, Warpage, Free Edges, etc.) that mirror ANSA standards.
- **Autonomous Agent Heuristics**: Employs an intelligent loop to suggest and apply repairs such as:
  - Exact node projection onto nearest CAD surfaces.
  - Laplacian smoothing for quality relaxation.
  - Deduplicating nodes.
- **Desktop First**: Built on Electron + Vite + TypeScript for blazing fast local execution without data leaving your machine.

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (v18+) installed.

### Installation

1. Clone the repository and navigate into the directory.
2. Install the dependencies:
   ```bash
   cd meshmend
   npm install
   ```

### Running the Application

To start the Vite dev server and the Electron application concurrently:

```bash
npm run dev
```

The application window should pop up, allowing you to browse your local file system and load your mesh projects!

### Building for Production

To build the static assets and the Electron app:

```bash
npm run build
```

Then to start the compiled app:

```bash
npm run electron
```

Or just run `npm start` to build and start in one command.

## 🧪 Testing

The logic and diagnostics are heavily unit-tested using Vitest.

Run the test suite once:
```bash
npm run test
```

Run the tests in watch mode during development:
```bash
npm run test:watch
```

## 📖 How to Use the AI Auto-Fix Workflow

1. Export your Mesh (e.g. `.cdb`, `.bdf`, `.inp`) from your pre-processor.
2. Export your Geometry (e.g. `.step`).
3. Open MeshMend AI, and use the built-in file explorer to navigate to your project directory.
4. **Important**: Click the `.step` file **first** to load the CAD model into memory.
5. Click your mesh file **second** to load the elements and nodes.
6. Switch to the **Agent** tab and click **Run Auto-Fix**. The AI will analyze the mesh, detect defects, and automatically project and smooth nodes to align with your CAD surfaces while maintaining element quality.

## 🏗️ Architecture

MeshMend AI's core components:
- **`mesh-parser.ts`**: High-performance, chunk-based streaming parsers for large FEA files.
- **`cad-kernel.ts`**: The OpenCascade WASM wrapper responsible for `.step` ingestion and `BRepExtrema_DistShapeShape_1` BVH distance queries.
- **`diagnostic-engine.ts`**: The diagnostic orchestrator checking against configurable quality thresholds (`defect-record.ts`).
- **`agent-loop.ts`**: The AI action loop that iterates over defects and applies strategies from `mesh-tools.ts`.
- **`ui/`**: The frontend rendering layer, primarily built with vanilla DOM / modern JS.

## 📄 License

MIT License.
