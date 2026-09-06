const initOpenCascade = require('opencascade.js');
const fs = require('fs');

async function run() {
  const oc = await initOpenCascade();
  
  // Create a sphere to act as our CAD shape
  const sphere = new oc.BRepPrimAPI_MakeSphere_1(10.0);
  const shape = sphere.Solid();
  
  // Point to project
  const point = new oc.gp_Pnt_3(15, 0, 0);
  const vertexMaker = new oc.BRepBuilderAPI_MakeVertex(point);
  const vertexShape = vertexMaker.Vertex();
  
  // Calculate distance
  const dist = new oc.BRepExtrema_DistShapeShape_2(shape, vertexShape, 1, 1e-7);
  dist.Perform();
  
  if (dist.IsDone() && dist.NbSolution() > 0) {
    const value = dist.Value();
    const p1 = dist.PointOnShape1(1); // On shape (the sphere)
    const p2 = dist.PointOnShape2(1); // On shape2 (the vertex)
    
    console.log(`Distance: ${value}`);
    console.log(`P1: [${p1.X()}, ${p1.Y()}, ${p1.Z()}]`);
  } else {
    console.log("No solution");
  }
}

run().catch(console.error);
