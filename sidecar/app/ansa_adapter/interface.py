from abc import ABC, abstractmethod
from typing import Dict, List, Optional
from app.models import ModelInfo, Feature, Defect, MeshQualityMetrics, RepairOperation

class ANSAAdapterInterface(ABC):
    @abstractmethod
    def is_available(self) -> bool:
        """Check if ANSA is installed and available."""
        pass

    @abstractmethod
    def open_model(self, filepath: str) -> bool:
        """Open an .ansa file."""
        pass

    @abstractmethod
    def get_model_info(self) -> ModelInfo:
        """Get high-level statistics and metadata."""
        pass

    @abstractmethod
    def detect_features(self) -> Dict[str, Feature]:
        """Identify geometric/topological features (holes, ribs, etc)."""
        pass

    @abstractmethod
    def analyze_feature_defects(self, feature: Feature) -> List[Defect]:
        """Analyze a specific feature for known defect patterns."""
        pass

    @abstractmethod
    def execute_operation(self, operation: RepairOperation) -> bool:
        """Execute a specific repair operation (e.g. DeleteEntity, FacesMiddleSingle)."""
        pass

    @abstractmethod
    def get_region_quality(self, entities: List[int]) -> Optional[MeshQualityMetrics]:
        """Calculate quality metrics for a specific subset of elements."""
        pass

    @abstractmethod
    def save_model(self, filepath: str) -> bool:
        """Save the corrected .ansa file."""
        pass
