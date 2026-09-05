package com.dealflow.config;

import com.dealflow.auth.Actor;
import com.dealflow.auth.CurrentActor;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Lets a controller declare {@code Actor actor} and receive the verified
 * identity, so authorisation inputs are visible in the signature rather than
 * fetched from a thread-local somewhere inside the method.
 */
@Component
public class ActorArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return Actor.class.equals(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer container,
                                  NativeWebRequest request, WebDataBinderFactory binderFactory) {
        return CurrentActor.require();
    }
}
