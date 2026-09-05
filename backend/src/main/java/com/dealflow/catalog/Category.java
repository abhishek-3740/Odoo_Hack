package com.dealflow.catalog;

import com.dealflow.catalog.CatalogEnums.CategoryKind;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

/**
 * Category. Its {@code code} is the key discount ceilings are configured
 * against, so renaming a category does not silently move its ceiling.
 */
@Entity
@Table(name = "categories")
public class Category extends TimestampedEntity {

    @Column(name = "code", nullable = false, unique = true)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false)
    private CategoryKind kind;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    protected Category() {
    }

    public Category(String code, String name, CategoryKind kind) {
        this.code = code;
        this.name = name;
        this.kind = kind;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public CategoryKind getKind() {
        return kind;
    }

    public void setKind(CategoryKind kind) {
        this.kind = kind;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
