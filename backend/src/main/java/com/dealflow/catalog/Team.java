package com.dealflow.catalog;

import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

@Entity
@Table(name = "teams")
public class Team extends TimestampedEntity {

    @Column(name = "name", nullable = false, unique = true)
    private String name;

    protected Team() {
    }

    public Team(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
