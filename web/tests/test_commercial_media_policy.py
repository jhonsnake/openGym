"""Commercial builds must not distribute restricted exercise stills/clips."""
from pathlib import Path
import os
import subprocess
import tarfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class CommercialMediaPolicy(unittest.TestCase):
    def test_default_final_stage_is_commercial_and_has_no_media_copy(self):
        dockerfile = (ROOT / 'web/Dockerfile').read_text()
        self.assertRegex(dockerfile, r'(?m)^FROM\s+runtime\s+AS\s+commercial\s*$')
        commercial_start = dockerfile.index('FROM runtime AS commercial')
        self.assertNotIn('\nFROM ', dockerfile[commercial_start + 1:],
                         'commercial must be the final/default stage')
        commercial = dockerfile.split('FROM runtime AS commercial', 1)[1]
        self.assertNotIn('COPY catalogue/media/', commercial)
        self.assertRegex(commercial, r'(?m)^RUN .*BUILTIN_EXERCISE_MEDIA.*0')

    def test_commercial_stage_is_bound_to_disabled_build_flag(self):
        dockerfile = (ROOT / 'web/Dockerfile').read_text()
        self.assertIn('ARG BUILTIN_EXERCISE_MEDIA=0', dockerfile)
        commercial = dockerfile.split('FROM runtime AS commercial', 1)[1]
        self.assertRegex(commercial, r'test "\$BUILTIN_EXERCISE_MEDIA" = "0"')
        self.assertIn('ENV VITE_BUILTIN_EXERCISE_MEDIA=${BUILTIN_EXERCISE_MEDIA}', dockerfile)

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
