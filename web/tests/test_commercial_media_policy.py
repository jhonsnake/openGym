"""Commercial builds must not distribute restricted exercise stills/clips."""
from pathlib import Path
import os
import subprocess
import tarfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class CommercialMediaPolicy(unittest.TestCase):
    def test_dockerfile_excludes_catalogue_media(self):
        instructions = (ROOT / 'web/Dockerfile').read_text().splitlines()
        copies = [line.strip() for line in instructions if line.lstrip().upper().startswith('COPY ')]
        self.assertFalse(any('catalogue/media' in line for line in copies),
                         'Commercial web image still copies restricted catalogue/media')
        self.assertIn('ENV VITE_BUILTIN_EXERCISE_MEDIA=0', instructions,
                      'Commercial build must disable built-in media requests')

    @unittest.skipUnless(os.environ.get('OPENGYM_CANDIDATE_WEB_IMAGE'),
                         'Candidate-image verification is pending until an image is built')
    def test_candidate_filesystem_contains_no_builtin_exercise_media(self):
        image = os.environ['OPENGYM_CANDIDATE_WEB_IMAGE']
        container = subprocess.check_output(['docker', 'create', image], text=True).strip()
        try:
            proc = subprocess.Popen(['docker', 'export', container], stdout=subprocess.PIPE)
            assert proc.stdout is not None
            try:
                with tarfile.open(fileobj=proc.stdout, mode='r|') as archive:
                    forbidden = [entry.name for entry in archive
                                 if entry.isfile() and '/exercise-media/' in '/' + entry.name]
                self.assertEqual(proc.wait(timeout=30), 0)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                proc.stdout.close()
            self.assertEqual(forbidden, [], 'Restricted built-in exercise media found in candidate')
        finally:
            subprocess.run(['docker', 'rm', container], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    unittest.main()
