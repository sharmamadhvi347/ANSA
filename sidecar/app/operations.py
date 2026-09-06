from typing import Dict, Any, List
from pydantic import BaseModel

class OperationDefinition(BaseModel):
    name: str
    required_inputs: List[str]
    expected_input_types: Dict[str, str]
    applicable_contexts: List[str]
    prerequisites: List[str]
    expected_effect: str
    validation_requirements: List[str]

class OperationRegistry:
    def __init__(self):
        self.operations = {}
        self._register_all()

    def _register(self, op: OperationDefinition):
        self.operations[op.name] = op

    def _register_all(self):
        self._register(OperationDefinition(
            name="FacesMiddleSingle",
            required_inputs=["surface_a", "surface_b"],
            expected_input_types={"surface_a": "EntityList", "surface_b": "EntityList"},
            applicable_contexts=["Rib Feature"],
            prerequisites=["Verify opposite surfaces belong to same feature"],
            expected_effect="Create middle surface between two parallel/opposite surfaces",
            validation_requirements=["Midsurface is centered"]
        ))

        self._register(OperationDefinition(
            name="AlignGrids",
            required_inputs=["nodes", "target"],
            expected_input_types={"nodes": "NodeList", "target": "ReferenceEntity"},
            applicable_contexts=["Circular Hole on Boss", "Rib Feature", "Fillet Suppression", "DogHouse", "Mesh Quality"],
            prerequisites=["Target reference geometry exists"],
            expected_effect="Align nodes to match the target reference line/surface",
            validation_requirements=["Uniform node spacing", "Mesh continuity"]
        ))

        self._register(OperationDefinition(
            name="DeleteEntity",
            required_inputs=["entities"],
            expected_input_types={"entities": "EntityList"},
            applicable_contexts=["Circular Hole on Boss", "DogHouse+Boss with ribs"],
            prerequisites=["Ensure entities belong to localized defect region"],
            expected_effect="Remove unwanted mesh elements or geometric features",
            validation_requirements=["No disjoint or broken topology left behind (must reconstruct)"]
        ))

        self._register(OperationDefinition(
            name="PasteNodes",
            required_inputs=["source_nodes", "target_nodes"],
            expected_input_types={"source_nodes": "NodeList", "target_nodes": "NodeList"},
            applicable_contexts=["Fillet Suppression", "DogHouse+Boss with ribs"],
            prerequisites=["Source and target nodes must be topologically adjacent/collapsible"],
            expected_effect="Collapse nodes to create sharp edge/suppress fillet",
            validation_requirements=["Sharp corner established", "No inverted elements"]
        ))

        self._register(OperationDefinition(
            name="ReconstructShells",
            required_inputs=["region_elements"],
            expected_input_types={"region_elements": "ElementList"},
            applicable_contexts=["All Mesh Repairs"],
            prerequisites=["Local area identified"],
            expected_effect="Generate new shell mesh based on boundary conditions",
            validation_requirements=["No mesh collapse", "Boundary conforms to surrounding mesh"]
        ))

        self._register(OperationDefinition(
            name="SplitElements",
            required_inputs=["elements"],
            expected_input_types={"elements": "ElementList"},
            applicable_contexts=["Mesh Quality", "Fillet Suppression", "DogHouse+Boss with ribs"],
            prerequisites=["Element size transition too large"],
            expected_effect="Subdivide elements to improve transition grading",
            validation_requirements=["Smooth element size transition"]
        ))

        self._register(OperationDefinition(
            name="SmoothShells",
            required_inputs=["elements"],
            expected_input_types={"elements": "ElementList"},
            applicable_contexts=["Mesh Quality", "Fillet Suppression", "DogHouse+Boss with ribs"],
            prerequisites=["Area reconstructed or nodes pasted"],
            expected_effect="Relax nodes to improve element shape metrics",
            validation_requirements=["Improves skewness, aspect ratio, minimum angle"]
        ))

        self._register(OperationDefinition(
            name="FixQuality",
            required_inputs=["elements"],
            expected_input_types={"elements": "ElementList"},
            applicable_contexts=["Mesh Quality"],
            prerequisites=["Elements must be visible/selected"],
            expected_effect="Automatically resolve skewed, warped, or failed Jacobian elements",
            validation_requirements=["All criteria pass thresholds"]
        ))

    def get_operation(self, name: str) -> OperationDefinition:
        if name not in self.operations:
            raise ValueError(f"Unknown domain operation: {name}")
        return self.operations[name]
