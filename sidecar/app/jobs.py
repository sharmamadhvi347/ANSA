import os
import shutil
from typing import Dict
from app.models import RepairJob, JobStatus, ValidationResult, ValidationStatus
from app.planner import RepairPlanner
from app.ansa_adapter.stub_adapter import StubANSAAdapter
from app.ansa_adapter.real_adapter import RealANSAAdapter
import logging

logger = logging.getLogger(__name__)

class JobManager:
    def __init__(self, work_dir: str):
        self.work_dir = work_dir
        os.makedirs(self.work_dir, exist_ok=True)
        self.jobs: Dict[str, RepairJob] = {}
        self.planner = RepairPlanner()
        
        real_adapter = RealANSAAdapter()
        if real_adapter.is_available():
            self.adapter = real_adapter
        else:
            self.adapter = StubANSAAdapter()

    def create_job(self, original_filepath: str) -> RepairJob:
        if not os.path.exists(original_filepath):
            raise FileNotFoundError(f"Original file not found: {original_filepath}")
        
        job = RepairJob(original_filepath=original_filepath)
        self.jobs[job.job_id] = job
        
        ext = os.path.splitext(original_filepath)[1]
        working_filename = f"work_{job.job_id}{ext}"
        working_filepath = os.path.join(self.work_dir, working_filename)
        
        try:
            shutil.copy2(original_filepath, working_filepath)
            job.working_filepath = working_filepath
            job.status = JobStatus.CREATED
            logger.info(f"Created working copy for job {job.job_id}")
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error_message = f"Failed to create working copy: {str(e)}"
            
        return job

    def run_job(self, job_id: str):
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job not found: {job_id}")
            
        try:
            # 1. Inspection
            job.status = JobStatus.INSPECTING
            self.adapter.open_model(job.working_filepath)
            job.model_info = self.adapter.get_model_info()
            
            features = self.adapter.detect_features()
            for f in features.values():
                f.defects = self.adapter.analyze_feature_defects(f)
            job.model_info.features = features

            # 2. Planning
            job.status = JobStatus.PLANNING
            job.repair_plans = self.planner.generate_plans(job.model_info.features)
            
            # 3. Execution
            job.status = JobStatus.EXECUTING
            if not self.adapter.is_available():
                # EXPLICITLY FAIL IF ANSA IS UNAVAILABLE
                job.status = JobStatus.FAILED
                job.error_message = "ANSA runtime unavailable - execution cannot be performed."
                return job
                
            for plan_id, plan in job.repair_plans.items():
                for op in plan.ordered_operations:
                    self.adapter.execute_operation(op)
                    
            # 4. Validation
            job.status = JobStatus.VALIDATING
            if not self.adapter.is_available():
                job.status = JobStatus.FAILED
                job.error_message = "ANSA runtime unavailable - validation cannot be performed."
                return job

            for feature_id, feature in job.model_info.features.items():
                if feature_id not in job.repair_plans:
                    continue # No repair attempted
                    
                plan = job.repair_plans[feature_id]
                new_metrics = self.adapter.get_region_quality(feature.entities)
                
                if new_metrics is None:
                    job.validation_results[feature_id] = ValidationResult(
                        status=ValidationStatus.INCONCLUSIVE,
                        reason="Real mesh evidence unavailable."
                    )
                else:
                    passed = True
                    if "min_jacobian" in plan.validation_criteria.thresholds:
                        if new_metrics.jacobian < plan.validation_criteria.thresholds["min_jacobian"]:
                            passed = False
                            
                    job.validation_results[feature_id] = ValidationResult(
                        status=ValidationStatus.PASS if passed else ValidationStatus.FAIL,
                        metrics_before=feature.defects[0].metrics if feature.defects else None,
                        metrics_after=new_metrics,
                        reason="Criteria met" if passed else "Criteria failed"
                    )

            # Save
            final_filepath = os.path.join(self.work_dir, f"final_{job.job_id}.ansa")
            self.adapter.save_model(final_filepath)
            job.status = JobStatus.COMPLETED
            
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error_message = str(e)
            logger.error(f"Job {job_id} failed: {str(e)}")
            
        return job
