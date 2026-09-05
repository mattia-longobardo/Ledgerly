DROP INDEX "provider_links_external_uq";--> statement-breakpoint
DROP INDEX "provider_links_entity_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "provider_links_external_uq" ON "provider_links" USING btree ("user_id","provider","entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_links_entity_uq" ON "provider_links" USING btree ("user_id","provider","entity_type","entity_id");