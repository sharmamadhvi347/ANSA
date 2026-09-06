from enum import Enum
from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field
import uuid

class JobStatus(str, Enum):
    CREATED = "CREATED"
    UPLOADING = "UPLOADING"
    INSPECTING = "INSPECTING"
    ANALYZING = "ANALYZING"
    PLANNING = "PLANNING"
    EXECUTING = "EXECUTING"
    VALIDATING = "VALIDATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class ValidationStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    INCONCLUSIVE = "INCONCLUSIVE"

class FeatureType(str, Enum):
    HOLE = "HOLE"
    BOSS = "BOSS"
    RIB = "RIB"
    FILLET = "FILLET"
    DOGHOUSE = "DOGHOUSE"
    SLOT = "SLOT"
    WALL = "WALL"
    CORNER = "CORNER"
    UNKNOWN = "UNKNOWN"
    # Composites
    CIRCULAR_HOLE_ON_BOSS = "CIRCULAR_HOLE_ON_BOSS"
    DOGHOUSE_WITH_RIBS = "DOGHOUSE_WITH_RIBS"
    FILLET_AND_RIB = "FILLET_AND_RIB"

class DefectCategory(str, Enum):
    GEOMETRY_FEATURE = "GEOMETRY_FEATURE"
    TOPOLOGY = "TOPOLOGY"
    MESH_QUALITY = "MESH_QUALITY"

class DefectType(str, Enum):
    # Geometry/Feature
    INACCURATE_HOLE = "INACCURATE_HOLE"
    MISSING_SLOT_CORNER = "MISSING_SLOT_CORNER"
    INCORRECT_RIB_REPRESENTATION = "INCORRECT_RIB_REPRESENTATION"
    INCORRECT_RIB_WIDTH = "INCORRECT_RIB_WIDTH"
    UNSUPPRESSED_FILLET = "UNSUPPRESSED_FILLET"
    UNEVEN_TRANSITION = "UNEVEN_TRANSITION"
    # Topology
    IRREGULAR_BOUNDARY_FLOW = "IRREGULAR_BOUNDARY_FLOW"
    NON_CONCENTRIC_FLOW = "NON_CONCENTRIC_FLOW"
    MESH_COLLAPSE = "MESH_COLLAPSE"
    BROKEN_TOPOLOGY = "BROKEN_TOPOLOGY"
    POOR_CONNECTIVITY = "POOR_CONNECTIVITY"
    RESIDUAL_FEATURE_MESH = "RESIDUAL_FEATURE_MESH"
    # Quality
    HIGH_SKEW = "HIGH_SKEW"
    HIGH_WARPAGE = "HIGH_WARPAGE"
    LOW_JACOBIAN = "LOW_JACOBIAN"
    POOR_MIN_ANGLE = "POOR_MIN_ANGLE"
    NON_UNIFORM_DISTRIBUTION = "NON_UNIFORM_DISTRIBUTION"

class DefectSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    MINOR = "MINOR"

class MeshQualityMetrics(BaseModel):
    aspect_ratio: Optional[float] = None
    jacobian: Optional[float] = None
    skewness: Optional[float] = None
    warpage: Optional[float] = None
    min_angle: Optional[float] = None

class DetectionEvidence(BaseModel):
    description: str
    affected_elements: List[int] = Field(default_factory=list)
    affected_nodes: List[int] = Field(default_factory=list)
    measured_metrics: Optional[Dict[str, float]] = None

class Defect(BaseModel):
    defect_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    defect_type: DefectType
    category: DefectCategory
    severity: DefectSeverity
    evidence: DetectionEvidence
    metrics: MeshQualityMetrics

class Feature(BaseModel):
    feature_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    feature_type: FeatureType
    bounding_box: Optional[Dict[str, float]] = None
    entities: List[int] = Field(default_factory=list)
    defects: List[Defect] = Field(default_factory=list)

class ModelInfo(BaseModel):
    filename: str
    node_count: int
    element_count: int
    features: Dict[str, Feature] = Field(default_factory=dict)
    global_quality: Optional[MeshQualityMetrics] = None

class RepairOperation(BaseModel):
    operation_name: str
    entities: List[int] = Field(default_factory=list)
    params: Dict[str, Any] = Field(default_factory=dict)
    expected_outcome: str

class ValidationCriteria(BaseModel):
    must_improve: List[str] = Field(default_factory=list)
    must_remain_unchanged: List[str] = Field(default_factory=list)
    failure_conditions: List[str] = Field(default_factory=list)
    required_evidence: List[str] = Field(default_factory=list)
    thresholds: Dict[str, float] = Field(default_factory=dict)

class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    LOW = "LOW"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    UNSUPPORTED = "UNSUPPORTED"

class RepairPlan(BaseModel):
    plan_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_case: str
    target_feature_id: str
    target_region: Optional[Dict[str, float]] = None
    detected_defects: List[str] = Field(default_factory=list)
    reasoning: str
    ordered_operations: List[RepairOperation]
    operation_dependencies: List[str] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    expected_outcome: str
    validation_criteria: ValidationCriteria
    confidence: ConfidenceLevel
    rollback_conditions: List[str] = Field(default_factory=list)
    diagnostic_message: Optional[str] = None


class ValidationResult(BaseModel):
    status: ValidationStatus
    metrics_before: Optional[MeshQualityMetrics] = None
    metrics_after: Optional[MeshQualityMetrics] = None
    reason: str

class RepairJob(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: JobStatus = JobStatus.CREATED
    original_filepath: str
    working_filepath: Optional[str] = None
    model_info: Optional[ModelInfo] = None
    repair_plans: Dict[str, RepairPlan] = Field(default_factory=dict)
    validation_results: Dict[str, ValidationResult] = Field(default_factory=dict)
    error_message: Optional[str] = None
