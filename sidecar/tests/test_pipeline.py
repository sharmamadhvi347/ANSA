import pytest
import os
from app.models import Feature, FeatureType, Defect, DefectType, DefectCategory, DefectSeverity, DetectionEvidence, MeshQualityMetrics, ConfidenceLevel
from app.strategies import StrategyEngine
from app.planner import RepairPlanner

def test_circular_hole_on_boss():
    engine = StrategyEngine()
    feature = Feature(feature_type=FeatureType.CIRCULAR_HOLE_ON_BOSS, entities=[1])
    defect = Defect(
        defect_type=DefectType.NON_CONCENTRIC_FLOW,
        category=DefectCategory.TOPOLOGY,
        severity=DefectSeverity.CRITICAL,
        evidence=DetectionEvidence(description="TEST"),
        metrics=MeshQualityMetrics()
    )
    candidates = engine.find_candidate_strategies(feature, [defect])
    assert len(candidates) == 1
    assert candidates[0].name == "CircularHoleOnBossStrategy"
    plan = candidates[0].generate_plan(feature, [defect])
    assert plan.source_case == "1. Circular Hole on Boss"
    assert len(plan.ordered_operations) == 3

def test_rib_feature():
    engine = StrategyEngine()
    feature = Feature(feature_type=FeatureType.RIB, entities=[1])
    defect = Defect(
        defect_type=DefectType.MESH_COLLAPSE,
        category=DefectCategory.TOPOLOGY,
        severity=DefectSeverity.CRITICAL,
        evidence=DetectionEvidence(description="TEST"),
        metrics=MeshQualityMetrics()
    )
    candidates = engine.find_candidate_strategies(feature, [defect])
    assert len(candidates) == 1
    assert candidates[0].name == "RibFeatureStrategy"
    plan = candidates[0].generate_plan(feature, [defect])
    assert plan.ordered_operations[0].operation_name == "FacesMiddleSingle"

def test_fillet_suppression():
    engine = StrategyEngine()
    feature = Feature(feature_type=FeatureType.FILLET_AND_RIB, entities=[1])
    defect = Defect(
        defect_type=DefectType.UNSUPPRESSED_FILLET,
        category=DefectCategory.GEOMETRY_FEATURE,
        severity=DefectSeverity.CRITICAL,
        evidence=DetectionEvidence(description="TEST"),
        metrics=MeshQualityMetrics()
    )
    candidates = engine.find_candidate_strategies(feature, [defect])
    assert len(candidates) == 1
    assert candidates[0].name == "FilletSuppressionStrategy"
    plan = candidates[0].generate_plan(feature, [defect])
    assert len(plan.ordered_operations) == 5

def test_rib_quality_only():
    engine = StrategyEngine()
    feature = Feature(feature_type=FeatureType.RIB, entities=[1])
    defect = Defect(
        defect_type=DefectType.LOW_JACOBIAN,
        category=DefectCategory.MESH_QUALITY,
        severity=DefectSeverity.WARNING,
        evidence=DetectionEvidence(description="TEST"),
        metrics=MeshQualityMetrics()
    )
    candidates = engine.find_candidate_strategies(feature, [defect])
    assert len(candidates) == 1
    assert candidates[0].name == "RibFeatureMeshQualityStrategy"

def test_doghouse_boss_ribs():
    engine = StrategyEngine()
    feature = Feature(feature_type=FeatureType.DOGHOUSE_WITH_RIBS, entities=[1])
    defect = Defect(
        defect_type=DefectType.RESIDUAL_FEATURE_MESH,
        category=DefectCategory.TOPOLOGY,
        severity=DefectSeverity.WARNING,
        evidence=DetectionEvidence(description="TEST"),
        metrics=MeshQualityMetrics()
    )
    candidates = engine.find_candidate_strategies(feature, [defect])
    assert len(candidates) == 1
    assert candidates[0].name == "DogHouseBossRibsStrategy"

def test_unsupported_defect_handling():
    planner = RepairPlanner()
    feature = Feature(feature_type=FeatureType.UNKNOWN, entities=[1])
    defect = Defect(
        defect_type=DefectType.BROKEN_TOPOLOGY,
        category=DefectCategory.TOPOLOGY,
        severity=DefectSeverity.WARNING,
        evidence=DetectionEvidence(description="TEST"),
        metrics=MeshQualityMetrics()
    )
    feature.defects = [defect]
    plans = planner.generate_plans({"feat1": feature})
    assert plans["feat1"].confidence == ConfidenceLevel.UNSUPPORTED
    assert len(plans["feat1"].ordered_operations) == 0
