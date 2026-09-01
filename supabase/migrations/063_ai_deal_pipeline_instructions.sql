-- Per-account instructions for the AI deal classifier. This turns the
-- default sales funnel into a reusable workflow for products and services
-- across different market segments.
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS deal_pipeline_instructions text;
