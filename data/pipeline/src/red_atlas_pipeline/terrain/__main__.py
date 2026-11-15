"""Punto de entrada: `uv run python -m red_atlas_pipeline.terrain`."""
import sys

from .build import main

sys.exit(main())
