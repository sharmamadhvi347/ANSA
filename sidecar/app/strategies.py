from abc import ABC, abstractmethod
from typing import List, Optional
from app.models import (Feature, FeatureType, Defect, DefectType, 
                        RepairPlan, RepairOperation, ValidationCriteria, ConfidenceLevel)
from app.operations import OperationRegistry
import logging

logger = logging.getLogger(__name__)

class RepairStrategy(ABC):
    def __init__(self):
        self.op_registry = OperationRegistry()

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def source_case(self) -> str:
        """Traceability to Mesh_Healing.xlsx cases"""
        pass

    @abstractmethod
    def evaluate_applicability(self, feature: Feature, defects: List[Defect]) -> ConfidenceLevel:
        pass
        
    @abstractmethod
    def generate_plan(self, feature: Feature, defects: List[Defect]) -> RepairPlan:
        pass

class CircularHoleOnBossStrategy(RepairStrategy):
    @property
    def name(self) -> str: return "CircularHoleOnBossStrategy"
    @property
    def source_case(self) -> str: return "1. Circular Hole on Boss"

    def evaluate_applicability(self, feature: Feature, defects: List[Defect]) -> ConfidenceLevel:
        if feature.feature_type not in [FeatureType.CIRCULAR_HOLE_ON_BOSS, FeatureType.HOLE]:
            return ConfidenceLevel.UNSUPPORTED
            
        supported_defects = {
            DefectType.IRREGULAR_BOUNDARY_FLOW, DefectType.NON_CONCENTRIC_FLOW, 
            DefectType.LOW_JACOBIAN, DefectType.INACCURATE_HOLE, DefectType.MISSING_SLOT_CORNER, DefectType.UNEVEN_TRANSITION
        }
        
        defect_types = {d.defect_type for d in defects}
        if not defect_types.intersection(supported_defects):
            return ConfidenceLevel.UNSUPPORTED
            
        if not feature.entities:
            return ConfidenceLevel.INSUFFICIENT_EVIDENCE
            
        return ConfidenceLevel.HIGH

    def generate_plan(self, feature: Feature, defects: List[Defect]) -> RepairPlan:
        ops = [
            RepairOperation(
                operation_name="DeleteEntity",
                entities=feature.entities,
                params={"rows": 2},
                expected_outcome="Delete 2 to 3 rows of elements surrounding the hole."
            ),
            RepairOperation(
                operation_name="AlignGrids",
                params={"target": "hole_perimeter"},
                expected_outcome="Align mesh nodes to remain concentric."
            ),
            RepairOperation(
                operation_name="ReconstructShells",
                params={"preserve_outer_pattern": True},
                expected_outcome="Reconstruct mesh preserving outer pattern and slot corners."
            )
        ]
        
        vc = ValidationCriteria(
            must_improve=["concentricity", "jacobian"],
            must_remain_unchanged=["outer_mesh_pattern"],
            failure_conditions=["slot_corners_missing", "irregular_edges_present"],
            required_evidence=["post_mesh_metrics"],
            thresholds={"min_jacobian": 0.5, "max_aspect_ratio": 5.0}
        )
        
        return RepairPlan(
            source_case=self.source_case,
            target_feature_id=feature.feature_id,
            target_region=feature.bounding_box,
            detected_defects=[d.defect_type.value for d in defects],
            reasoning="Detected non-concentric flow and irregular elements around a boss hole. Removing poor elements, aligning, and reconstructing per case 1.",
            ordered_operations=ops,
            expected_outcome="Circular holes remain circular, slot corners captured accurately, smooth mesh flow.",
            validation_criteria=vc,
            confidence=ConfidenceLevel.HIGH
        )

class RibFeatureStrategy(RepairStrategy):
    @property
    def name(self) -> str: return "RibFeatureStrategy"
    @property
    def source_case(self) -> str: return "2. Rib Feature"

    def evaluate_applicability(self, feature: Feature, defects: List[Defect]) -> ConfidenceLevel:
        if feature.feature_type != FeatureType.RIB: return ConfidenceLevel.UNSUPPORTED
        
        target_defects = {DefectType.INCORRECT_RIB_WIDTH, DefectType.MESH_COLLAPSE}
        has_targets = any(d.defect_type in target_defects for d in defects)
        
        if not has_targets: return ConfidenceLevel.UNSUPPORTED
        if not feature.entities: return ConfidenceLevel.INSUFFICIENT_EVIDENCE
        return ConfidenceLevel.HIGH

    def generate_plan(self, feature: Feature, defects: List[Defect]) -> RepairPlan:
        ops = [
            RepairOperation(
                operation_name="FacesMiddleSingle",
                entities=feature.entities,
                params={"verify_topology": True},
                expected_outcome="Generate midsurface exactly centered."
            ),
            RepairOperation(
                operation_name="AlignGrids",
                params={"target": "middle_surface"},
                expected_outcome="Align elements to the newly created middle surface."
            )
        ]
        
        vc = ValidationCriteria(
            must_improve=["rib_width_capture"],
            must_remain_unchanged=["parent_surface_connection"],
            failure_conditions=["free_cons", "broken_topology"],
            required_evidence=["thickness_metrics"],
            thresholds={"max_thickness_deviation": 0.1}
        )
        
        return RepairPlan(
            source_case=self.source_case,
            target_feature_id=feature.feature_id,
            target_region=feature.bounding_box,
            detected_defects=[d.defect_type.value for d in defects],
            reasoning="Rib mesh collapses or width not captured. Generating midsurface and aligning nodes.",
            ordered_operations=ops,
            expected_outcome="Rib thickness is consistent and centered.",
            validation_criteria=vc,
            confidence=ConfidenceLevel.HIGH
        )

class FilletSuppressionStrategy(RepairStrategy):
    @property
    def name(self) -> str: return "FilletSuppressionStrategy"
    @property
    def source_case(self) -> str: return "3. Fillet suppression"

    def evaluate_applicability(self, feature: Feature, defects: List[Defect]) -> ConfidenceLevel:
        # Also handles "Fillet + Rib" (6, 7) and "DogHouse[Fillet]" (8)
        if feature.feature_type not in [FeatureType.FILLET, FeatureType.FILLET_AND_RIB]:
            return ConfidenceLevel.UNSUPPORTED
            
        target_defects = {DefectType.UNSUPPRESSED_FILLET, DefectType.NON_UNIFORM_DISTRIBUTION, DefectType.IRREGULAR_BOUNDARY_FLOW}
        if not any(d.defect_type in target_defects for d in defects):
            return ConfidenceLevel.UNSUPPORTED
            
        return ConfidenceLevel.HIGH

    def generate_plan(self, feature: Feature, defects: List[Defect]) -> RepairPlan:
        ops = [
            RepairOperation(operation_name="PasteNodes", entities=feature.entities, expected_outcome="Remove curved mesh flow by pasting nodes to wall."),
            RepairOperation(operation_name="ReconstructShells", expected_outcome="Reconstruct local area."),
            RepairOperation(operation_name="SplitElements", expected_outcome="Split elements where transition is too large."),
            RepairOperation(operation_name="SmoothShells", expected_outcome="Smooth continuous mesh structure."),
            RepairOperation(operation_name="AlignGrids", expected_outcome="Align mesh nodes with vertical and inclined feature lines.")
        ]
        
        vc = ValidationCriteria(
            must_improve=["element_distribution", "mesh_continuity"],
            must_remain_unchanged=[],
            failure_conditions=["residual_fillet_mesh", "distorted_corner"],
            required_evidence=["mesh_connectivity_check"],
            thresholds={"min_jacobian": 0.4}
        )
        
        return RepairPlan(
            source_case=self.source_case,
            target_feature_id=feature.feature_id,
            target_region=feature.bounding_box,
            detected_defects=[d.defect_type.value for d in defects],
            reasoning="Fillet disruption identified. Suppressing fillet via PasteNodes and aligning straight mesh flow.",
            ordered_operations=ops,
            operation_dependencies=["PasteNodes -> ReconstructShells -> SplitElements -> SmoothShells -> AlignGrids"],
            expected_outcome="Sharp corner mesh with continuous flow.",
            validation_criteria=vc,
            confidence=ConfidenceLevel.HIGH
        )

class RibFeatureMeshQualityStrategy(RepairStrategy):
    @property
    def name(self) -> str: return "RibFeatureMeshQualityStrategy"
    @property
    def source_case(self) -> str: return "4. Rib Feature (Mesh Quality)"

    def evaluate_applicability(self, feature: Feature, defects: List[Defect]) -> ConfidenceLevel:
        if feature.feature_type != FeatureType.RIB: return ConfidenceLevel.UNSUPPORTED
        
        quality_defects = {DefectType.HIGH_SKEW, DefectType.HIGH_WARPAGE, DefectType.LOW_JACOBIAN, DefectType.POOR_MIN_ANGLE}
        has_quality = any(d.defect_type in quality_defects for d in defects)
        # MUST NOT have geometry defects to qualify for pure quality repair
        has_geom = any(d.category == "GEOMETRY_FEATURE" for d in defects)
        
        if not has_quality or has_geom: return ConfidenceLevel.UNSUPPORTED
        return ConfidenceLevel.HIGH

    def generate_plan(self, feature: Feature, defects: List[Defect]) -> RepairPlan:
        ops = [
            RepairOperation(operation_name="ReconstructShells", entities=feature.entities, expected_outcome="Local reconstruction."),
            RepairOperation(operation_name="FixQuality", expected_outcome="Improve Skewness, Aspect Ratio, Warpage."),
            RepairOperation(operation_name="SplitElements", expected_outcome="Fix element size transition."),
            RepairOperation(operation_name="SmoothShells", expected_outcome="Relax elements."),
            RepairOperation(operation_name="AlignGrids", expected_outcome="Fix misaligned mesh rows.")
        ]
        
        return RepairPlan(
            source_case=self.source_case,
            target_feature_id=feature.feature_id,
            detected_defects=[d.defect_type.value for d in defects],
            reasoning="Rib feature passes geometry checks but fails mesh quality. Applying local quality improvements.",
            ordered_operations=ops,
            expected_outcome="Area passes quality criteria.",
            validation_criteria=ValidationCriteria(must_improve=["skew", "warpage", "jacobian", "min_angle"]),
            confidence=ConfidenceLevel.HIGH
        )

class DogHouseBossRibsStrategy(RepairStrategy):
    @property
    def name(self) -> str: return "DogHouseBossRibsStrategy"
    @property
    def source_case(self) -> str: return "5. Doughouse+Boss with ribs"

    def evaluate_applicability(self, feature: Feature, defects: List[Defect]) -> ConfidenceLevel:
        if feature.feature_type != FeatureType.DOGHOUSE_WITH_RIBS: return ConfidenceLevel.UNSUPPORTED
        return ConfidenceLevel.HIGH

    def generate_plan(self, feature: Feature, defects: List[Defect]) -> RepairPlan:
        ops = [
            RepairOperation(operation_name="DeleteEntity", entities=feature.entities, expected_outcome="Remove surrounding small boss ribs (<3mm)."),
            RepairOperation(operation_name="PasteNodes", expected_outcome="Remove residual fillet pattern."),
            RepairOperation(operation_name="ReconstructShells", expected_outcome="Simplify and remesh."),
            RepairOperation(operation_name="SplitElements", expected_outcome="Fix transition."),
            RepairOperation(operation_name="SmoothShells", expected_outcome="Smooth."),
            RepairOperation(operation_name="AlignGrids", expected_outcome="Align to vertical lines.")
        ]
        
        return RepairPlan(
            source_case=self.source_case,
            target_feature_id=feature.feature_id,
            detected_defects=[d.defect_type.value for d in defects],
            reasoning="Small boss features and ribs (<3mm) disrupt flow. Suppressing geometry and reconstructing.",
            ordered_operations=ops,
            operation_dependencies=["DeleteEntity -> PasteNodes -> ReconstructShells"],
            expected_outcome="Simplified geometry with continuous sharp corner mesh.",
            validation_criteria=ValidationCriteria(must_improve=["mesh_concentration", "mesh_flow"]),
            confidence=ConfidenceLevel.HIGH
        )

class StrategyEngine:
    def __init__(self):
        self.strategies = [
            CircularHoleOnBossStrategy(),
            RibFeatureStrategy(),
            FilletSuppressionStrategy(),
            RibFeatureMeshQualityStrategy(),
            DogHouseBossRibsStrategy()
        ]

    def find_candidate_strategies(self, feature: Feature, defects: List[Defect]) -> List[RepairStrategy]:
        candidates = []
        for strategy in self.strategies:
            conf = strategy.evaluate_applicability(feature, defects)
            if conf in [ConfidenceLevel.HIGH, ConfidenceLevel.LOW]:
                candidates.append(strategy)
        return candidates
