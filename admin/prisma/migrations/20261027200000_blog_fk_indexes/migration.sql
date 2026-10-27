CREATE INDEX "blog_posts_category_id_idx" ON "blog_posts"("category_id");
CREATE INDEX "blog_posts_layout_id_idx" ON "blog_posts"("layout_id");
CREATE INDEX "blog_categories_default_layout_id_idx" ON "blog_categories"("default_layout_id");
CREATE INDEX "blog_post_tags_tag_id_idx" ON "blog_post_tags"("tag_id");
