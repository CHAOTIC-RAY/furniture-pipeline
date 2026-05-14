-- Run this SQL in your PostgreSQL/Supabase database

-- Create the assets table for the Gallery
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name VARCHAR(255) NOT NULL,
    clean_name VARCHAR(255) NOT NULL,
    dimensions VARCHAR(50),
    url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create the pipeline_jobs table to track processing batches
CREATE TABLE pipeline_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(50) NOT NULL, -- e.g., 'Processing', 'Completed', 'Failed'
    total_images INTEGER NOT NULL,
    completed_images INTEGER DEFAULT 0,
    failed_images INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Create an index on created_at for sorting gallery
CREATE INDEX idx_assets_created_at ON assets(created_at DESC);
