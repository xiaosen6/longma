CREATE TABLE `knowledge_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL DEFAULT 'ready',
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`name` text NOT NULL,
	`source_path` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`error` text,
	`chunk_count` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_bases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`item_id` text NOT NULL,
	`seq` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `knowledge_items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `knowledge_chunks_fts` USING fts5(text, content=`knowledge_chunks`, content_rowid=`rowid`, tokenize=`trigram`);
