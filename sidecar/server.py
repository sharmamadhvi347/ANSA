import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from app.jobs import JobManager

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

app = Flask(__name__)
CORS(app)

job_manager = JobManager(work_dir="./work")

@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        "status": "online",
        "ansa_available": job_manager.adapter.is_available()
    })

@app.route('/api/jobs', methods=['POST'])
def create_job():
    data = request.json
    filepath = data.get('filepath')
    try:
        job = job_manager.create_job(filepath)
        return jsonify(job.model_dump())
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/jobs/<job_id>', methods=['GET'])
def get_job(job_id):
    job = job_manager.jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job.model_dump())

@app.route('/api/jobs/<job_id>/run', methods=['POST'])
def run_job(job_id):
    try:
        job = job_manager.run_job(job_id)
        return jsonify(job.model_dump())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
