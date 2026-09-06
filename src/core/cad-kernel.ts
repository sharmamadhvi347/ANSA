// @ts-ignore
import initOpenCascade, { OpenCascadeInstance } from 'opencascade.js/dist/opencascade.wasm.js';
// @ts-ignore
import wasmUrl from 'opencascade.js/dist/opencascade.wasm.wasm?url';

export interface NearestSurfacePointResult {
  point: [number, number, number];
  surfaceId: string;
  distance: number;
  normal: [number, number, number];
}

export interface CadQuery {
  nearestSurfacePoint(point: [number, number, number]): NearestSurfacePointResult;
}

export class CadKernel implements CadQuery {
  private oc!: OpenCascadeInstance;
  private cadShape: any = null; // TopoDS_Shape

  async init(): Promise<void> {
    this.oc = await initOpenCascade({
      locateFile: () => wasmUrl
    });
    console.log("OpenCascade initialized");
  }
  
  async loadSTEP(filePath: string, fileContent: Uint8Array): Promise<void> {
    if (!this.oc) throw new Error("CadKernel not initialized");
    
    const virtualFilename = "model.step";
    this.oc.FS.createDataFile("/", virtualFilename, fileContent, true, true);
    
    const reader = new this.oc.STEPControl_Reader_1();
    const status = reader.ReadFile(virtualFilename);
    
    // IFSelect_ReturnStatus_IFSelect_RetDone is usually 1
    if (status !== 1) { // 1 = IFSelect_RetDone
      throw new Error(`Failed to read STEP file. Status: ${status}`);
    }
    
    reader.TransferRoots(1);
    this.cadShape = reader.OneShape();
    console.log("STEP file loaded into OCCT TopoDS_Shape");
  }
  
  nearestSurfacePoint(point: [number, number, number]): NearestSurfacePointResult {
    if (!this.oc || !this.cadShape) {
      throw new Error("CAD shape not loaded");
    }

    // 1. Convert coordinate to OCCT Point
    const pnt = new this.oc.gp_Pnt_3(point[0], point[1], point[2]);
    
    // 2. Make a vertex from the point
    const vertexMaker = new this.oc.BRepBuilderAPI_MakeVertex(pnt);
    const vertexShape = vertexMaker.Vertex();
    
    // 3. Setup distance query between CAD shape and the point vertex
    const dist = new this.oc.BRepExtrema_DistShapeShape_1();
    dist.LoadS1(this.cadShape);
    dist.LoadS2_1(vertexShape);
    dist.Perform();
    
    if (dist.IsDone() && dist.NbSolution() > 0) {
      // 1-indexed for solutions
      const minPnt = dist.PointOnShape1(1); 
      const distance = dist.Value();
      
      const result: NearestSurfacePointResult = {
        point: [minPnt.X(), minPnt.Y(), minPnt.Z()],
        surfaceId: 'unknown',
        distance: distance,
        normal: [0, 0, 1] // Normal calculation omitted for performance
      };
      
      // Cleanup memory
      minPnt.delete();
      dist.delete();
      vertexMaker.delete();
      pnt.delete();
      
      return result;
    }
    
    // Cleanup memory on failure
    dist.delete();
    vertexMaker.delete();
    pnt.delete();
    
    throw new Error("Failed to find nearest point on surface");
  }
}
