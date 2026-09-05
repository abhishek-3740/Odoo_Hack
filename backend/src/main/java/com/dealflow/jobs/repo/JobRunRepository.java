package com.dealflow.jobs.repo;


import com.dealflow.jobs.models.*;
import com.dealflow.jobs.service.*;
import com.dealflow.jobs.controller.*;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

public interface JobRunRepository extends JpaRepository<JobRun, UUID> {

    List<JobRun> findByJobNameOrderByStartedAtDesc(String jobName, Limit limit);

    List<JobRun> findAllByOrderByStartedAtDesc(Limit limit);
}
