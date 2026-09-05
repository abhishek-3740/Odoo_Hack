package com.dealflow.catalog;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CustomerRepository extends JpaRepository<Customer, UUID> {

    Optional<Customer> findByNameIgnoreCase(String name);

    @Query("""
            select c from Customer c
             where c.active = true
               and (:search is null or lower(c.name) like lower(concat('%', :search, '%')))
            """)
    Page<Customer> search(@Param("search") String search, Pageable pageable);
}
