from typing import Dict, List, Optional
from app.models import Feature, Defect, RepairPlan, ConfidenceLevel, ValidationCriteria
from app.strategies import StrategyEngine
import logging

logger = logging.getLogger(__name__)

class RepairPlanner:
    def __init__(self):
        self.engine = StrategyEngine()

    def generate_plans(self, features: Dict[str, Feature]) -> Dict[str, RepairPlan]:
        plans = {}
        for feature_id, feature in features.items():
            if not feature.defects:
                logger.info(f"Feature {feature_id} has no defects. Skipping.")
                continue

            candidates = self.engine.find_candidate_strategies(feature, feature.defects)
            
            if not candidates:
                logger.warning(f"No supported strategy found for feature {feature_id} (Type: {feature.feature_type}). Rejecting.")
                plans[feature_id] = RepairPlan(
                    source_case="UNSUPPORTED",
                    target_feature_id=feature_id,
                    reasoning=f"Unsupported feature type {feature.feature_type.value} or defect combination.",
                    ordered_operations=[],
                    expected_outcome="None",
                    validation_criteria=ValidationCriteria(),
                    confidence=ConfidenceLevel.UNSUPPORTED,
                    diagnostic_message="No explicit strategy available in Knowledge Base for this geometry/defect topology."
                )
                continue

            # Select the first candidate (in a more complex engine, we would rank them)
            selected_strategy = candidates[0]
            logger.info(f"Selected {selected_strategy.name} for feature {feature_id}")
            
            plan = selected_strategy.generate_plan(feature, feature.defects)
            plans[feature_id] = plan
            
        # Optional: Resolve dependencies between plans if required by multi-feature
        return plans
