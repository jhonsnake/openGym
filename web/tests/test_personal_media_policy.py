"""Personal-test media variant: complete, unmodified catalogue plus notices."""
from hashlib import sha256
from pathlib import Path
import os
import subprocess
import tarfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / 'catalogue/media'


def source_manifest():
    files = {}
    for path in sorted(MEDIA.rglob('*')):
        if path.is_file():
            digest = sha256(path.read_bytes()).hexdigest()
            files[str(path.relative_to(MEDIA))] = digest
    return files


class PersonalMediaPolicy(unittest.TestCase):
    def test_personal_stage_requires_enabled_flag_and_copies_catalogue(self):
        dockerfile = (ROOT / 'web/Dockerfile').read_text()
        personal = dockerfile.split('FROM runtime AS personal-test', 1)[1]
        self.assertRegex(personal, r'test "\$BUILTIN_EXERCISE_MEDIA" = "1"')
        self.assertIn('COPY catalogue/media/ /usr/share/nginx/html/exercise-media/', personal)
        self.assertIn('COPY NOTICE.md LICENSE /usr/share/nginx/html/legal/', dockerfile)
        self.assertIn('catalogue/media/NOTICE.md', personal)

    def test_source_inventory_is_expected_complete_shape(self):
        manifest = source_manifest()
        self.assertEqual(len([p for p in manifest if p.startswith('clip/') and p.endswith('.mp4')]), 6554)
        self.assertEqual(len([p for p in manifest if p.startswith('still/') and p.endswith('.webp')]), 6554)
        self.assertEqual(set(manifest) - {
            p for p in manifest if p.startswith(('clip/', 'still/'))
        }, {'NOTICE.md'})
        self.assertFalse(any(path.lower().endswith('.gif') for path in manifest))

    @unittest.skipUnless(os.environ.get('OPENGYM_PERSONAL_TEST_WEB_IMAGE'),
                         'Personal real-image verification is pending until an image is built')
    def test_candidate_filesystem_matches_every_source_media_hash(self):
        image = os.environ['OPENGYM_PERSONAL_TEST_WEB_IMAGE']
        container = subprocess.check_output(['docker', 'create', image], text=True).strip()
        actual = {}
        try:
            proc = subprocess.Popen(['docker', 'export', container], stdout=subprocess.PIPE)
            assert proc.stdout is not None
            try:
                with tarfile.open(fileobj=proc.stdout, mode='r|') as archive:
                    for entry in archive:
                        prefix = 'usr/share/nginx/html/exercise-media/'
                        if entry.isfile() and entry.name.startswith(prefix):
                            rel = entry.name[len(prefix):]
                            stream = archive.extractfile(entry)
                            assert stream is not None
                            digest = sha256()
                            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                                digest.update(chunk)
                            actual[rel] = digest.hexdigest()
                self.assertEqual(proc.wait(timeout=30), 0)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                proc.stdout.close()
            self.assertEqual(actual, source_manifest())
        finally:
            subprocess.run(['docker', 'rm', container], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    unittest.main()
