import logging
import uvicorn

# Uvicorn must never emit request URLs, IPs, headers or exceptions.
logging.disable(logging.CRITICAL)
if __name__ == '__main__':
    uvicorn.run('app.main:create_app', factory=True, host='127.0.0.1', port=8000,
                access_log=False, log_config=None, log_level='critical', proxy_headers=False)
