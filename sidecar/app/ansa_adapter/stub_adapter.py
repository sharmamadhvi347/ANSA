import logging
from typing import Dict, List, Optional
import os
from app.models import (ModelInfo, Feature, FeatureType, Defect, DefectType, 
                        DefectCategory, DefectSeverity, DetectionEvidence, 
                        MeshQualityMetrics, RepairOperation)
from app.ansa_adapter.interface import ANSAAdapterInterface

logger = logging.getLogger(__name__)

class StubANSAAdapter(ANSAAdapterInterface):
    def __init__(self):
        self.opened_file = None

    def is_available(self) -> bool:
        return False # EXPLICITLY UNAVAILABLE

    def open_model(self, filepath: str) -> bool:
        logger.info(f"[STUB] Opening {filepath}")
        self.opened_file = filepath
        return True

    def get_model_info(self) -> ModelInfo:
        logger.warning("[STUB] Returning mocked ModelInfo since ANSA is unavailable.")
        return ModelInfo(
            filename=os.path.basename(self.opened_file) if self.opened_file else "unknown.ansa",
            node_count=0,
            element_count=0
        )

    def detect_features(self) -> Dict[str, Feature]:
        logger.warning("[STUB] Returning mocked features since ANSA is unavailable.")
        # Only used to prove the pipeline without ANSA
        f = Feature(
            feature_type=FeatureType.CIRCULAR_HOLE_ON_BOSS,
            entities=[100, 101, 102],
            bounding_box={"xmin": 0, "xmax": 10, "ymin": 0, "ymax": 10, "zmin": 0, "zmax": 2}
        )
        return {f.feature_id: f}

    def analyze_feature_defects(self, feature: Feature) -> List[Defect]:
        logger.warning(f"[STUB] Analyzing defects for feature {feature.feature_id} without ANSA.")
        if feature.feature_type == FeatureType.CIRCULAR_HOLE_ON_BOSS:
            return [
                Defect(
                    defect_type=DefectType.NON_CONCENTRIC_FLOW,
                    category=DefectCategory.TOPOLOGY,
                    severity=DefectSeverity.CRITICAL,
                    evidence=DetectionEvidence(
                        description="Elements around the hole boundary are not concentric.",
                        affected_elements=feature.entities
                    ),
                    metrics=MeshQualityMetrics(jacobian=0.25, aspect_ratio=6.0, skewness=0.8)
                )
            ]
        return []

    def execute_operation(self, operation: RepairOperation) -> bool:
        logger.warning(f"[STUB] Cannot execute {operation.operation_name} - ANSA runtime unavailable.")
        return False # Cannot actually execute

    def get_region_quality(self, entities: List[int]) -> Optional[MeshQualityMetrics]:
        logger.warning("[STUB] Cannot measure quality - ANSA runtime unavailable.")
        return None

    def save_model(self, filepath: str) -> bool:
        logger.info(f"[STUB] Saving to {filepath} (Fake write)")
        return True
