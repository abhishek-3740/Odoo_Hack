package com.dealflow.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, UUID> {
    Optional<Category> findByCode(String code);

    List<Category> findByActiveTrueOrderByNameAsc();
}
