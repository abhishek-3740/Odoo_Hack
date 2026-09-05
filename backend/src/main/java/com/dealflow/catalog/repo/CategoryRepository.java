package com.dealflow.catalog.repo;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, UUID> {
    Optional<Category> findByCode(String code);

    List<Category> findByActiveTrueOrderByNameAsc();
}
