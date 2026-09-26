# Test clips for `vision:e2echeck`

Synthetic `testsrc` patterns, a few seconds each, generated with the worker
image's own ffmpeg. They carry no footage and no rights question, so they are
safe to commit — unlike real match video, which must never be in git.

```bash
# The path is relative to services/api, which is where pnpm --filter runs the script.
pnpm --filter @dtp/api vision:e2echeck test-media/sample-720p.mp4
```

Two resolutions on purpose: the gate reads the expected dimensions from the file
it is given, and running both is what proves it, rather than passing only for the
one clip it was written against.

To regenerate, or make another size:

```bash
docker run --rm -v "$PWD:/out" --entrypoint ffmpeg dtp-vision-engine:0.1.0-cpu \
  -f lavfi -i testsrc=size=1280x720:rate=25 -t 5 -c:v libx264 -pix_fmt yuv420p -y /out/sample-720p.mp4
```
